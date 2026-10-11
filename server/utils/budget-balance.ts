/**
 * Saldo eines Budgets als virtuelles Konto (ADR-0004).
 *
 * Reine Funktionen ohne DB-Zugriff — der Saldo wird nie persistiert, sondern
 * pro Request aus Versionen und realen Buchungen aggregiert (wie Coverage,
 * ADR-0002, und Forecast, ADR-0003). Nachgebuchte, geaenderte oder geloeschte
 * Buchungen korrigieren den Saldo damit automatisch, auch ueber geschlossene
 * Vorgaenger hinweg.
 *
 *   saldo(b, t) = Σ Zuteilungen der Perioden mit Start in [balanceSince, min(t, closedAt))
 *               − Σ Ausgaben (budgetId = b, Datum in [balanceSince, t])
 *               − Σ Umbuchungen in Spartoepfe (sourceBudgetId = b, Datum in [balanceSince, t])
 *               + Σ saldo(v, t) aller Vorgaenger v (carryoverToBudgetId = b),
 *                 sobald t ≥ max(v.closedAt, b.balanceSince)
 *
 * Alle Vergleiche laufen tagesgenau ueber `startOfDay` (12:00 Serverzeit,
 * wie `parseDateInput`/`startOfPeriod`) — sonst fiele eine Buchung um 09:00
 * am Starttag vor die 12:00-Grenze von `balanceSince`.
 */
import type { Frequency } from '@prisma/client'
import { addPeriod, startOfPeriod } from './budget-evaluation'

export type BalanceBudget = {
  id: string
  frequency: Frequency
  balanceSince: Date
  closedAt: Date | null
  carryoverToBudgetId: string | null
  versions: Array<{ amount: number; validFrom: Date }>
}

export type BalanceExpense = {
  budgetId: string | null
  amount: number
  date: Date
}

export type BalanceTransfer = {
  sourceBudgetId: string | null
  amount: number
  date: Date
}

export type BudgetBalance = {
  /** Aktueller Saldo inkl. Uebertraegen von Vorgaengern. */
  balance: number
  allocated: number
  spent: number
  /** Netto in Spartoepfe umgebucht (negativ = aus Toepfen ins Budget). */
  transferred: number
  /** Summe der eingeflossenen Endsalden geschlossener Vorgaenger. */
  carriedOver: number
}

/** Tagesgenauer Vergleichsschluessel (12:00 Serverzeit), siehe Kopfkommentar. */
export function dayKey(date: Date) {
  const value = new Date(date)
  value.setHours(12, 0, 0, 0)
  return value.getTime()
}

/**
 * Version, die die Periode ab `periodStart` zuteilt: die zum Periodenbeginn
 * gueltige. Eine Version, die mitten in der Periode beginnt, greift erst ab
 * der naechsten — ausser es gab vorher noch gar keine Version, dann teilt
 * die erste in der Periode beginnende schon diese Periode zu (gleiche Regel
 * wie `findWeekVersion` in budget-evaluation.ts, #142).
 */
function findAllocatingVersion(
  versions: BalanceBudget['versions'],
  periodStart: number,
  periodEnd: number,
) {
  let active: BalanceBudget['versions'][number] | null = null
  for (const version of versions) {
    if (dayKey(version.validFrom) <= periodStart) active = version
  }
  if (active) return active
  return versions.find((version) => {
    const key = dayKey(version.validFrom)
    return key >= periodStart && key < periodEnd
  }) ?? null
}

export type BalanceAllocation = {
  /** Periodenbeginn, zu dem gutgeschrieben wird. */
  date: Date
  amount: number
  /** Zuteilende Version (Referenz aus `budget.versions`), fuer Versionswechsel im Verlauf. */
  version: BalanceBudget['versions'][number] | null
}

/**
 * Alle Zuteilungen fuer Perioden mit Start in `[balanceSince, min(at, closedAt))`,
 * chronologisch. Eine Periode, deren Start auf `at` faellt, ist bereits
 * zugeteilt. Perioden ohne gueltige Version tauchen mit Betrag 0 auf, damit
 * der Verlauf auch den Beginn der ersten Version als Wechsel erkennt.
 */
export function listAllocations(budget: BalanceBudget, at: Date): BalanceAllocation[] {
  const versions = [...budget.versions].sort((left, right) => left.validFrom.getTime() - right.validFrom.getTime())
  const atKey = dayKey(at)
  const closedKey = budget.closedAt ? dayKey(budget.closedAt) : Number.POSITIVE_INFINITY
  const isOpenAt = (periodStart: number) => periodStart <= atKey && periodStart < closedKey
  const allocationFor = (start: Date, end: number): BalanceAllocation => {
    const version = findAllocatingVersion(versions, start.getTime(), end)
    return { date: start, amount: version?.amount ?? 0, version }
  }

  // ONCE: genau eine Zuteilung zu `balanceSince`, ohne Folgeperiode.
  if (budget.frequency === 'ONCE') {
    const start = new Date(dayKey(budget.balanceSince))
    if (!isOpenAt(start.getTime())) return []
    return [allocationFor(start, Number.POSITIVE_INFINITY)]
  }

  const allocations: BalanceAllocation[] = []
  // `balanceSince` ist immer ein Periodenbeginn; startOfPeriod schuetzt nur
  // gegen Altdaten, die es nicht sind.
  let cursor = startOfPeriod(budget.balanceSince, budget.frequency)
  while (isOpenAt(cursor.getTime())) {
    const next = addPeriod(cursor, budget.frequency)
    // Schutz gegen Endlosschleifen bei kaputten Daten (unbekannte Frequenz,
    // ungueltiges Datum): das Raster muss vorwaerts laufen.
    if (!(next.getTime() > cursor.getTime())) break
    allocations.push(allocationFor(cursor, next.getTime()))
    cursor = next
  }
  return allocations
}

/**
 * Summe der Zuteilungen fuer alle Perioden mit Start in
 * `[balanceSince, min(at, closedAt))`.
 */
export function computeAllocations(budget: BalanceBudget, at: Date): number {
  return listAllocations(budget, at).reduce((total, allocation) => total + allocation.amount, 0)
}

/**
 * Tagesschluessel des Zeitpunkts, zu dem der Endsaldo eines Vorgaengers ins
 * Ziel einfliesst: der spaetere von Stichtag des Vorgaengers und Saldo-Start
 * des Ziels. Ein (inkonsistent) offener Vorgaenger fliesst nie ein.
 */
export function getCarryoverInflowKey(
  predecessor: Pick<BalanceBudget, 'closedAt'>,
  target: Pick<BalanceBudget, 'balanceSince'>,
): number {
  return Math.max(
    predecessor.closedAt ? dayKey(predecessor.closedAt) : Number.POSITIVE_INFINITY,
    dayKey(target.balanceSince),
  )
}

/**
 * Salden aller uebergebenen Budgets zum Zeitpunkt `at` (Default: heute).
 *
 * `expenses` muss bereits auf `deletedAt: null` gefiltert sein. Buchungen
 * vor `balanceSince` und nach `at` werden hier verworfen, die Query darf
 * also grosszuegiger sein. Vorgaenger muessen in `budgets` enthalten sein,
 * sonst fehlt ihr Endsaldo im Ziel.
 */
export function computeBudgetBalances(
  budgets: BalanceBudget[],
  expenses: BalanceExpense[],
  transfers: BalanceTransfer[],
  at: Date = new Date(),
): Map<string, BudgetBalance> {
  const atKey = dayKey(at)
  const budgetsById = new Map(budgets.map((budget) => [budget.id, budget]))
  const predecessorsByTarget = new Map<string, BalanceBudget[]>()
  for (const budget of budgets) {
    if (!budget.carryoverToBudgetId) continue
    const list = predecessorsByTarget.get(budget.carryoverToBudgetId) ?? []
    list.push(budget)
    predecessorsByTarget.set(budget.carryoverToBudgetId, list)
  }

  const inBalanceWindow = (budgetId: string, date: Date) => {
    const budget = budgetsById.get(budgetId)
    if (!budget) return false
    const key = dayKey(date)
    return key >= dayKey(budget.balanceSince) && key <= atKey
  }

  const spentByBudget = new Map<string, number>()
  for (const expense of expenses) {
    if (!expense.budgetId || !inBalanceWindow(expense.budgetId, expense.date)) continue
    spentByBudget.set(expense.budgetId, (spentByBudget.get(expense.budgetId) ?? 0) + expense.amount)
  }

  const transferredByBudget = new Map<string, number>()
  for (const transfer of transfers) {
    if (!transfer.sourceBudgetId || !inBalanceWindow(transfer.sourceBudgetId, transfer.date)) continue
    transferredByBudget.set(
      transfer.sourceBudgetId,
      (transferredByBudget.get(transfer.sourceBudgetId) ?? 0) + transfer.amount,
    )
  }

  const results = new Map<string, BudgetBalance>()
  const inProgress = new Set<string>()

  const resolve = (budget: BalanceBudget): BudgetBalance => {
    const cached = results.get(budget.id)
    if (cached) return cached
    // Zyklen schliesst die Schliessen-Validierung aus (Ziel muss zum
    // Stichtag offen sein). Falls Daten trotzdem einen enthalten, zaehlt
    // der Zyklus-Rueckweg als 0 statt in eine Endlosrekursion zu laufen.
    if (inProgress.has(budget.id)) {
      return { balance: 0, allocated: 0, spent: 0, transferred: 0, carriedOver: 0 }
    }
    inProgress.add(budget.id)

    let carriedOver = 0
    for (const predecessor of predecessorsByTarget.get(budget.id) ?? []) {
      if (atKey >= getCarryoverInflowKey(predecessor, budget)) {
        carriedOver += resolve(predecessor).balance
      }
    }

    const allocated = computeAllocations(budget, at)
    const spent = spentByBudget.get(budget.id) ?? 0
    const transferred = transferredByBudget.get(budget.id) ?? 0
    const result = {
      balance: allocated - spent - transferred + carriedOver,
      allocated,
      spent,
      transferred,
      carriedOver,
    }

    inProgress.delete(budget.id)
    results.set(budget.id, result)
    return result
  }

  for (const budget of budgets) resolve(budget)
  return results
}

/**
 * Fruehester `balanceSince` — untere Grenze fuer die Buchungs-Queries, die
 * `computeBudgetBalances` versorgen.
 */
export function getEarliestBalanceSince(budgets: Array<{ balanceSince: Date }>): Date | null {
  let earliest: Date | null = null
  for (const budget of budgets) {
    if (!earliest || budget.balanceSince < earliest) earliest = budget.balanceSince
  }
  return earliest
}
