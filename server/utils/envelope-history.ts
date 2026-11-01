/**
 * Saldo-Verlauf eines Umschlags (ADR-0005) fuer die Detailansicht: Tagesend-
 * Salden und die Ereignisse im Zeitraum. Reine Funktionen.
 *
 * Der Verlauf umfasst die Vorgaenger-Kette: Vor dem Uebertrag zaehlt der
 * Saldo eines geschlossenen Vorgaengers mit, danach steckt er ohnehin im
 * Saldo des Ziels. So laeuft die Kurve bei einem Frequenzwechsel ohne Sprung
 * durch (wie `computeChainBalances` fuer Budgets, ADR-0004).
 */
import { dayKey } from './budget-balance'
import { computeEnvelopeBalances, type BalanceEnvelope, type EnvelopeBalanceInputs } from './envelope-balance'

export type HistoryEntryType = 'allocation' | 'income' | 'expense' | 'transfer' | 'carryover'

export type HistoryEntry = {
  type: HistoryEntryType
  id: string | null
  date: Date
  /** Vorzeichen aus Sicht des Umschlags: + = Zufluss. */
  amount: number
  /** Umschlag der Kette, an dem die Buchung haengt. */
  envelopeId: string
  /** Beschreibung bzw. Notiz. */
  text: string | null
  /** Gegenseite einer Umbuchung oder Herkunft eines Uebertrags; null = "Zu verteilen". */
  counterpartId: string | null
}

export type HistoryPoint = { date: Date; balance: number }

export type DetailedInputs = {
  expenses: Array<EnvelopeBalanceInputs['expenses'][number] & { id: string; description: string | null }>
  incomes: Array<EnvelopeBalanceInputs['incomes'][number] & { id: string; description: string | null }>
  transfers: Array<EnvelopeBalanceInputs['transfers'][number] & { id: string; note: string | null }>
}

/** Der Umschlag und alle (transitiven) Vorgaenger, die in ihn geschlossen wurden. */
export function getEnvelopeChain<E extends BalanceEnvelope>(envelopes: E[], envelopeId: string): E[] {
  const chain: E[] = []
  const queue = [envelopeId]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const envelope = envelopes.find((item) => item.id === id)
    if (!envelope) continue
    chain.push(envelope)
    for (const predecessor of envelopes) {
      if (predecessor.closedAt && predecessor.carryoverToEnvelopeId === id) queue.push(predecessor.id)
    }
  }
  return chain
}

function inflowKey(predecessor: BalanceEnvelope, target: BalanceEnvelope) {
  return Math.max(predecessor.closedAt ? dayKey(predecessor.closedAt) : Number.POSITIVE_INFINITY, dayKey(target.balanceSince))
}

function days(from: Date, to: Date): Date[] {
  const result: Date[] = []
  const cursor = new Date(dayKey(from))
  const end = dayKey(to)
  while (cursor.getTime() <= end) {
    result.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

/**
 * Tagesend-Salden der Kette von `from` bis `to` (beide inklusive).
 * `chain[0]` ist der betrachtete Umschlag.
 */
export function computeEnvelopeHistoryPoints(
  chain: BalanceEnvelope[],
  inputs: EnvelopeBalanceInputs,
  from: Date,
  to: Date,
): HistoryPoint[] {
  const byId = new Map(chain.map((envelope) => [envelope.id, envelope]))
  return days(from, to).map((date) => {
    const balances = computeEnvelopeBalances(chain, inputs, date)
    const key = dayKey(date)
    const chainBalance = (envelope: BalanceEnvelope): number => {
      let total = balances.get(envelope.id)?.balance ?? 0
      for (const predecessor of chain) {
        if (predecessor.carryoverToEnvelopeId !== envelope.id || !predecessor.closedAt) continue
        // Noch nicht eingeflossen: zaehlt neben dem Ziel, sonst steckt er schon drin.
        if (key < inflowKey(predecessor, envelope)) total += chainBalance(predecessor)
      }
      return total
    }
    return { date, balance: chainBalance(byId.get(chain[0]!.id)!) }
  })
}

/** Ereignisse der Kette im Zeitraum `[from, to]`, neueste zuerst. */
export function listEnvelopeHistoryEntries(
  chain: BalanceEnvelope[],
  inputs: DetailedInputs,
  from: Date,
  to: Date,
): HistoryEntry[] {
  const fromKey = dayKey(from)
  const toKey = dayKey(to)
  const ids = new Set(chain.map((envelope) => envelope.id))
  const sinceOf = new Map(chain.map((envelope) => [envelope.id, dayKey(envelope.balanceSince)]))
  const inRange = (id: string | null, date: Date): id is string => {
    if (!id || !ids.has(id)) return false
    const key = dayKey(date)
    return key >= fromKey && key <= toKey && key >= (sinceOf.get(id) ?? Number.NEGATIVE_INFINITY)
  }

  const entries: HistoryEntry[] = []
  for (const expense of inputs.expenses) {
    if (inRange(expense.envelopeId, expense.date)) {
      entries.push({ type: 'expense', id: expense.id, date: expense.date, amount: -expense.amount, envelopeId: expense.envelopeId, text: expense.description, counterpartId: null })
    }
  }
  for (const income of inputs.incomes) {
    if (inRange(income.envelopeId, income.date)) {
      entries.push({ type: 'income', id: income.id, date: income.date, amount: income.amount, envelopeId: income.envelopeId, text: income.description, counterpartId: null })
    }
  }
  for (const transfer of inputs.transfers) {
    if (inRange(transfer.toEnvelopeId, transfer.date)) {
      entries.push({
        type: transfer.allocationPeriodStart ? 'allocation' : 'transfer',
        id: transfer.id,
        date: transfer.date,
        amount: transfer.amount,
        envelopeId: transfer.toEnvelopeId,
        text: transfer.note,
        counterpartId: transfer.fromEnvelopeId,
      })
    }
    if (inRange(transfer.fromEnvelopeId, transfer.date)) {
      entries.push({ type: 'transfer', id: transfer.id, date: transfer.date, amount: -transfer.amount, envelopeId: transfer.fromEnvelopeId, text: transfer.note, counterpartId: transfer.toEnvelopeId })
    }
  }

  // Uebertraege: Endsaldo des Vorgaengers am Einflusstag, als Information —
  // der Verlauf selbst laeuft ohne Sprung durch.
  for (const predecessor of chain) {
    const target = chain.find((envelope) => envelope.id === predecessor.carryoverToEnvelopeId)
    if (!target || !predecessor.closedAt) continue
    const key = inflowKey(predecessor, target)
    if (key < fromKey || key > toKey) continue
    const date = new Date(key)
    const balance = computeEnvelopeBalances(chain, inputs, date).get(predecessor.id)?.balance ?? 0
    entries.push({ type: 'carryover', id: null, date, amount: balance, envelopeId: target.id, text: null, counterpartId: predecessor.id })
  }

  return entries.sort((left, right) => right.date.getTime() - left.date.getTime())
}
