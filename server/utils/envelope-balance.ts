/**
 * Salden von Umschlaegen und "Zu verteilen" (ADR-0005).
 *
 * Reine Funktionen ohne DB-Zugriff; die Anbindung liegt in
 * `envelope-store.ts`. Anders als bei ADR-0004 sind Zuteilungen gebuchte
 * Zeilen (`EnvelopeTransfer` mit `allocationPeriodStart`), der Saldo ist also
 * eine reine Summe ueber Buchungen:
 *
 *   saldo(u, t) = Σ Einnahmen (envelopeId = u) − Σ Ausgaben (envelopeId = u)
 *               + Σ Umbuchungen nach u − Σ Umbuchungen aus u
 *               + Σ saldo(v, t) aller Vorgaenger v (carryoverToEnvelopeId = u),
 *                 sobald t ≥ max(v.closedAt, u.balanceSince)
 *               jeweils mit Datum in [u.balanceSince, t]
 *
 *   saldo(Zu verteilen, t) = openingBalance
 *               + Σ Einnahmen ohne Umschlag − Σ Ausgaben ohne Umschlag
 *               + Σ Umbuchungen nach "Zu verteilen" − Σ Umbuchungen daraus
 *               + Σ saldo(v, t) aller in "Zu verteilen" geschlossenen v,
 *                 sobald t ≥ max(v.closedAt, ledgerSince)
 *               jeweils mit Datum in [ledgerSince, t]
 *
 * Vergleiche laufen tagesgenau ueber `dayKey`, wie in `budget-balance.ts`.
 */
import { dayKey } from './budget-balance'

export type BalanceEnvelope = {
  id: string
  balanceSince: Date
  closedAt: Date | null
  /** Nur bei `closedAt`: Ziel des Endsaldos, null = "Zu verteilen". */
  carryoverToEnvelopeId: string | null
}

/** Ausgabe oder Einnahme; `envelopeId` null = "Zu verteilen". */
export type EnvelopeBooking = {
  envelopeId: string | null
  amount: number
  date: Date
}

export type EnvelopeTransferRow = {
  fromEnvelopeId: string | null
  toEnvelopeId: string | null
  amount: number
  date: Date
  allocationPeriodStart?: Date | null
}

export type EnvelopeBalanceInputs = {
  /** Bereits auf `deletedAt: null` gefiltert. */
  expenses: EnvelopeBooking[]
  /** Bereits auf `deletedAt: null` gefiltert. */
  incomes: EnvelopeBooking[]
  transfers: EnvelopeTransferRow[]
}

export type EnvelopeBalance = {
  /** Aktueller Saldo inkl. Uebertraegen von Vorgaengern. */
  balance: number
  /** Gebuchte Zuteilungen (Teil von `transferredIn`). */
  allocated: number
  income: number
  spent: number
  transferredIn: number
  transferredOut: number
  carriedOver: number
}

export type LedgerStart = {
  ledgerSince: Date
  openingBalance: number
}

function emptyBalance(): EnvelopeBalance {
  return { balance: 0, allocated: 0, income: 0, spent: 0, transferredIn: 0, transferredOut: 0, carriedOver: 0 }
}

/**
 * Tagesschluessel, ab dem der Endsaldo eines geschlossenen Umschlags in sein
 * Ziel einfliesst: der spaetere von Stichtag und Startpunkt des Ziels. Ein
 * (inkonsistent) offener Vorgaenger fliesst nie ein.
 */
function carryoverInflowKey(predecessor: BalanceEnvelope, targetSince: Date): number {
  return Math.max(
    predecessor.closedAt ? dayKey(predecessor.closedAt) : Number.POSITIVE_INFINITY,
    dayKey(targetSince),
  )
}

/**
 * Salden aller uebergebenen Umschlaege zum Zeitpunkt `at` (Default: heute).
 * Buchungen ausserhalb von `[balanceSince, at]` werden hier verworfen, die
 * Query darf also grosszuegiger sein. Vorgaenger muessen in `envelopes`
 * enthalten sein, sonst fehlt ihr Endsaldo im Ziel.
 */
export function computeEnvelopeBalances(
  envelopes: BalanceEnvelope[],
  inputs: EnvelopeBalanceInputs,
  at: Date = new Date(),
): Map<string, EnvelopeBalance> {
  const atKey = dayKey(at)
  const byId = new Map(envelopes.map((envelope) => [envelope.id, envelope]))
  const own = new Map<string, EnvelopeBalance>()
  const totalsFor = (id: string) => {
    let totals = own.get(id)
    if (!totals) {
      totals = emptyBalance()
      own.set(id, totals)
    }
    return totals
  }
  const inWindow = (id: string | null, date: Date): id is string => {
    if (!id) return false
    const envelope = byId.get(id)
    if (!envelope) return false
    const key = dayKey(date)
    return key >= dayKey(envelope.balanceSince) && key <= atKey
  }

  for (const expense of inputs.expenses) {
    if (inWindow(expense.envelopeId, expense.date)) totalsFor(expense.envelopeId).spent += expense.amount
  }
  for (const income of inputs.incomes) {
    if (inWindow(income.envelopeId, income.date)) totalsFor(income.envelopeId).income += income.amount
  }
  for (const transfer of inputs.transfers) {
    if (inWindow(transfer.toEnvelopeId, transfer.date)) {
      const totals = totalsFor(transfer.toEnvelopeId)
      totals.transferredIn += transfer.amount
      if (transfer.allocationPeriodStart) totals.allocated += transfer.amount
    }
    if (inWindow(transfer.fromEnvelopeId, transfer.date)) totalsFor(transfer.fromEnvelopeId).transferredOut += transfer.amount
  }

  const predecessorsByTarget = new Map<string, BalanceEnvelope[]>()
  for (const envelope of envelopes) {
    if (!envelope.closedAt || !envelope.carryoverToEnvelopeId) continue
    const list = predecessorsByTarget.get(envelope.carryoverToEnvelopeId) ?? []
    list.push(envelope)
    predecessorsByTarget.set(envelope.carryoverToEnvelopeId, list)
  }

  const results = new Map<string, EnvelopeBalance>()
  const inProgress = new Set<string>()
  const resolve = (envelope: BalanceEnvelope): EnvelopeBalance => {
    const cached = results.get(envelope.id)
    if (cached) return cached
    // Zyklen schliesst die Schliessen-Validierung aus; falls Daten doch einen
    // enthalten, zaehlt der Rueckweg als 0 statt endlos zu rekursieren.
    if (inProgress.has(envelope.id)) return emptyBalance()
    inProgress.add(envelope.id)

    let carriedOver = 0
    for (const predecessor of predecessorsByTarget.get(envelope.id) ?? []) {
      if (atKey >= carryoverInflowKey(predecessor, envelope.balanceSince)) carriedOver += resolve(predecessor).balance
    }
    const totals = own.get(envelope.id) ?? emptyBalance()
    const result: EnvelopeBalance = {
      ...totals,
      carriedOver,
      balance: totals.income - totals.spent + totals.transferredIn - totals.transferredOut + carriedOver,
    }

    inProgress.delete(envelope.id)
    results.set(envelope.id, result)
    return result
  }

  for (const envelope of envelopes) resolve(envelope)
  return results
}

/**
 * Saldo von "Zu verteilen" zum Zeitpunkt `at`. `envelopes` und `balances`
 * werden fuer die in "Zu verteilen" geschlossenen Umschlaege gebraucht.
 */
export function computeUnassignedBalance(
  ledger: LedgerStart,
  envelopes: BalanceEnvelope[],
  balances: Map<string, EnvelopeBalance>,
  inputs: EnvelopeBalanceInputs,
  at: Date = new Date(),
): number {
  const atKey = dayKey(at)
  const sinceKey = dayKey(ledger.ledgerSince)
  const inWindow = (date: Date) => {
    const key = dayKey(date)
    return key >= sinceKey && key <= atKey
  }

  let balance = ledger.openingBalance
  for (const income of inputs.incomes) {
    if (income.envelopeId === null && inWindow(income.date)) balance += income.amount
  }
  for (const expense of inputs.expenses) {
    if (expense.envelopeId === null && inWindow(expense.date)) balance -= expense.amount
  }
  for (const transfer of inputs.transfers) {
    if (!inWindow(transfer.date)) continue
    if (transfer.toEnvelopeId === null) balance += transfer.amount
    if (transfer.fromEnvelopeId === null) balance -= transfer.amount
  }
  for (const envelope of envelopes) {
    if (!envelope.closedAt || envelope.carryoverToEnvelopeId !== null) continue
    if (atKey >= carryoverInflowKey(envelope, ledger.ledgerSince)) balance += balances.get(envelope.id)?.balance ?? 0
  }
  return balance
}

/**
 * Fruehester Zeitpunkt, ab dem Buchungen fuer die Salden gebraucht werden —
 * untere Grenze fuer die Queries in `envelope-store.ts`.
 */
export function getEarliestRelevantDate(envelopes: Array<{ balanceSince: Date }>, ledgerSince: Date | null): Date | null {
  let earliest: Date | null = ledgerSince
  for (const envelope of envelopes) {
    if (!earliest || envelope.balanceSince < earliest) earliest = envelope.balanceSince
  }
  return earliest
}
