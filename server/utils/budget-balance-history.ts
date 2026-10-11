/**
 * Verlauf des Budgetsaldos (ADR-0004) — reine Funktionen ohne DB-Zugriff.
 *
 * Jeder Punkt der Zeitreihe ist ein Aufruf von `computeBudgetBalances` zum
 * jeweiligen Tag. Damit gibt es genau eine Saldo-Formel: Der Verlauf kann
 * nicht von der Saldo-Anzeige abweichen, und Regeln wie Version-zum-
 * Periodenbeginn oder Einfliesszeitpunkt des Uebertrags gelten automatisch
 * auch hier. Der Mehraufwand (ein Durchlauf pro Ereignistag) ist bei
 * Haushaltsmengen vernachlaessigbar.
 *
 * **Kettensaldo:** Ein Nachfolge-Budget (z.B. "Lebensmittel" monatlich, in
 * das das woechentliche geschlossen wurde) soll eine durchgehende Linie
 * zeigen statt bei 0 zu beginnen und am Uebertrag zu springen. Deshalb
 * zaehlt im Verlauf jeder Vorgaenger, dessen Endsaldo noch nicht
 * eingeflossen ist, schon vorher mit:
 *
 *   kette(b, t) = saldo(b, t) + Σ kette(v, t) aller Vorgaenger v mit t < Einfliesszeitpunkt(v → b)
 *
 * Ab dem Einfliesszeitpunkt steckt der Vorgaenger in `saldo(b, t)` selbst —
 * die Linie springt dort also nicht, der Uebertrag wird nur als Ereignis
 * markiert.
 */
import {
  computeBudgetBalances,
  dayKey,
  getCarryoverInflowKey,
  listAllocations,
  type BalanceBudget,
  type BalanceExpense,
  type BalanceTransfer,
} from './budget-balance'

export type BalanceHistoryPoint = {
  /** YYYY-MM-DD (Serverzeit) — tagesgenau wie die Saldo-Formel. */
  date: string
  /** Kettensaldo am Ende dieses Tages. */
  balance: number
}

export type BalanceHistoryEventType = 'transfer' | 'version' | 'carryover'

export type BalanceHistoryEvent = {
  type: BalanceHistoryEventType
  date: string
  /**
   * transfer: umgebuchter Betrag (positiv = in den Spartopf, Saldo sinkt).
   * version: neue Zuteilung pro Periode.
   * carryover: eingeflossener Endsaldo des Vorgaengers.
   */
  amount: number
  /** Budget der Kette, an dem das Ereignis haengt. */
  budgetId: string
  /** Nur carryover: der geschlossene Vorgaenger. */
  fromBudgetId?: string
}

export type BalanceHistory = {
  from: string
  to: string
  points: BalanceHistoryPoint[]
  events: BalanceHistoryEvent[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function formatDayKey(key: number): string {
  const date = new Date(key)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Vortag als Tagesschluessel — `setDate` statt `- DAY_MS`, sonst verrutscht die Zeitumstellung. */
function previousDayKey(key: number): number {
  const date = new Date(key)
  date.setDate(date.getDate() - 1)
  return dayKey(date)
}

function addDaysKey(key: number, days: number): number {
  const date = new Date(key)
  date.setDate(date.getDate() + days)
  return dayKey(date)
}

function groupPredecessors(budgets: BalanceBudget[]) {
  const byTarget = new Map<string, BalanceBudget[]>()
  for (const budget of budgets) {
    if (!budget.carryoverToBudgetId) continue
    const list = byTarget.get(budget.carryoverToBudgetId) ?? []
    list.push(budget)
    byTarget.set(budget.carryoverToBudgetId, list)
  }
  return byTarget
}

/**
 * Das Budget selbst plus alle (transitiven) Vorgaenger, deren Saldo in
 * seinen Kettensaldo einfliesst. Zyklen (durch die Schliessen-Validierung
 * ausgeschlossen) werden ueber `seen` abgefangen.
 */
export function getBudgetChain(budgets: BalanceBudget[], budgetId: string): BalanceBudget[] {
  const byId = new Map(budgets.map((budget) => [budget.id, budget]))
  const predecessors = groupPredecessors(budgets)
  const chain: BalanceBudget[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    const budget = byId.get(id)
    if (!budget || seen.has(id)) return
    seen.add(id)
    chain.push(budget)
    for (const predecessor of predecessors.get(id) ?? []) visit(predecessor.id)
  }
  visit(budgetId)
  return chain
}

/**
 * Fruehester Saldo-Start der Kette. Davor existierte das Konto noch nicht —
 * eine Nulllinie ueber diesen Abschnitt waere nur Leerraum im Chart.
 */
function getChainStartKey(chain: BalanceBudget[]): number {
  return Math.min(...chain.map((budget) => dayKey(budget.balanceSince)))
}

/**
 * Kettensaldo aller Budgets zum Zeitpunkt `at` (siehe Kopfkommentar).
 */
export function computeChainBalances(
  budgets: BalanceBudget[],
  expenses: BalanceExpense[],
  transfers: BalanceTransfer[],
  at: Date,
): Map<string, number> {
  const balances = computeBudgetBalances(budgets, expenses, transfers, at)
  const predecessors = groupPredecessors(budgets)
  const atKey = dayKey(at)
  const results = new Map<string, number>()
  const inProgress = new Set<string>()

  const resolve = (budget: BalanceBudget): number => {
    const cached = results.get(budget.id)
    if (cached !== undefined) return cached
    if (inProgress.has(budget.id)) return 0
    inProgress.add(budget.id)
    let total = balances.get(budget.id)?.balance ?? 0
    for (const predecessor of predecessors.get(budget.id) ?? []) {
      if (atKey < getCarryoverInflowKey(predecessor, budget)) total += resolve(predecessor)
    }
    inProgress.delete(budget.id)
    results.set(budget.id, total)
    return total
  }

  for (const budget of budgets) resolve(budget)
  return results
}

/**
 * Saldo-Verlauf eines Budgets im Zeitraum `[from, to]` (tagesgenau).
 *
 * - `from` wird auf den Saldo-Start der Kette angehoben, falls es davor liegt.
 * - Erster Punkt: Startsaldo am `from` = Stand am Ende des Vortags, damit
 *   Bewegungen am `from` selbst als Stufe sichtbar sind.
 * - Danach ein Punkt pro Tag mit mindestens einer Bewegung irgendwo in der
 *   Kette (Zuteilung, Ausgabe, Umbuchung, Uebertrag).
 * - Letzter Punkt immer am `to`, damit die Stufenlinie bis zum Ende reicht.
 *
 * `budgets` muss alle Budgets des Haushalts enthalten (wie bei
 * `computeBudgetBalances`), `expenses` bereits auf `deletedAt: null` gefiltert.
 */
export function computeBudgetBalanceHistory(
  budgets: BalanceBudget[],
  expenses: BalanceExpense[],
  transfers: BalanceTransfer[],
  budgetId: string,
  from: Date,
  to: Date,
): BalanceHistory {
  const toKey = dayKey(to)
  const chain = getBudgetChain(budgets, budgetId)
  // Zeitraum beginnt fruehestens mit dem Saldo-Start der Kette (nie nach `to`).
  const fromKey = Math.min(toKey, Math.max(dayKey(from), chain.length > 0 ? getChainStartKey(chain) : dayKey(from)))
  const inRange = (key: number) => key >= fromKey && key <= toKey

  const eventDays = new Set<number>()
  const events: BalanceHistoryEvent[] = []

  for (const budget of chain) {
    const sinceKey = dayKey(budget.balanceSince)

    let previousAmount: number | null = null
    for (const allocation of listAllocations(budget, to)) {
      const key = dayKey(allocation.date)
      // Wechsel = andere Zuteilung als in der Vorperiode. Die erste Periode
      // ist kein Wechsel, sondern der Start des Kontos; eine neue Version
      // mit gleichem Betrag aendert am Verlauf nichts.
      const isChange = previousAmount !== null && allocation.amount !== previousAmount
      previousAmount = allocation.amount
      if (!inRange(key)) continue
      if (allocation.amount !== 0) eventDays.add(key)
      if (isChange) {
        events.push({ type: 'version', date: formatDayKey(key), amount: allocation.amount, budgetId: budget.id })
      }
    }

    for (const expense of expenses) {
      if (expense.budgetId !== budget.id) continue
      const key = dayKey(expense.date)
      if (key >= sinceKey && inRange(key)) eventDays.add(key)
    }

    for (const transfer of transfers) {
      if (transfer.sourceBudgetId !== budget.id) continue
      const key = dayKey(transfer.date)
      if (key < sinceKey || !inRange(key)) continue
      eventDays.add(key)
      events.push({ type: 'transfer', date: formatDayKey(key), amount: transfer.amount, budgetId: budget.id })
    }

    for (const predecessor of budgets) {
      if (predecessor.carryoverToBudgetId !== budget.id) continue
      const inflowKey = getCarryoverInflowKey(predecessor, budget)
      if (!Number.isFinite(inflowKey) || !inRange(inflowKey)) continue
      eventDays.add(inflowKey)
      // Betrag = Endsaldo des Vorgaengers, so wie er beim Einfliessen
      // gezaehlt wird (inkl. aller Korrekturen bis heute).
      const carried = computeBudgetBalances(budgets, expenses, transfers, new Date(inflowKey)).get(predecessor.id)
      events.push({
        type: 'carryover',
        date: formatDayKey(inflowKey),
        amount: carried?.balance ?? 0,
        budgetId: budget.id,
        fromBudgetId: predecessor.id,
      })
    }
  }

  const balanceAt = (key: number) => computeChainBalances(budgets, expenses, transfers, new Date(key)).get(budgetId) ?? 0

  const points: BalanceHistoryPoint[] = [{ date: formatDayKey(fromKey), balance: balanceAt(previousDayKey(fromKey)) }]
  const days = [...eventDays].sort((left, right) => left - right)
  for (const key of days) points.push({ date: formatDayKey(key), balance: balanceAt(key) })
  if (days.at(-1) !== toKey) points.push({ date: formatDayKey(toKey), balance: balanceAt(toKey) })

  events.sort((left, right) => left.date.localeCompare(right.date))

  return { from: formatDayKey(fromKey), to: formatDayKey(toKey), points, events }
}

/**
 * Grobe Saldo-Verlaeufe fuer viele Budgets auf einmal (Dashboard-Sparklines):
 * Stichproben im festen Raster `stepDays` von `from` bis `to` (`to` immer
 * dabei), pro Budget erst ab dem Saldo-Start seiner Kette. Ein `computeBudgetBalances`-Durchlauf pro Stichtag fuer alle
 * Budgets zusammen statt eines Requests pro Budget.
 */
export function computeBalanceTrends(
  budgets: BalanceBudget[],
  expenses: BalanceExpense[],
  transfers: BalanceTransfer[],
  budgetIds: string[],
  from: Date,
  to: Date,
  stepDays = 7,
): Map<string, BalanceHistoryPoint[]> {
  const toKey = dayKey(to)
  const keys: number[] = []
  for (let key = dayKey(from); key < toKey; key = addDaysKey(key, Math.max(1, stepDays))) keys.push(key)
  keys.push(toKey)

  // Stichtage vor dem Saldo-Start einer Kette entfallen fuer dieses Budget
  // (wie beim Detail-Verlauf); den Starttag selbst ergaenzen, damit die
  // Sparkline mit der ersten Zuteilung beginnt statt eine Woche spaeter.
  const startKeys = new Map(budgetIds.map((id) => {
    const chain = getBudgetChain(budgets, id)
    return [id, chain.length > 0 ? getChainStartKey(chain) : Number.NEGATIVE_INFINITY] as const
  }))
  const allKeys = new Set(keys)
  for (const start of startKeys.values()) {
    if (start > keys[0]! && start < toKey) allKeys.add(start)
  }
  const sortedKeys = [...allKeys].sort((left, right) => left - right)

  const trends = new Map<string, BalanceHistoryPoint[]>(budgetIds.map((id) => [id, []]))
  for (const key of sortedKeys) {
    const balances = computeChainBalances(budgets, expenses, transfers, new Date(key))
    for (const id of budgetIds) {
      const start = startKeys.get(id)!
      // Rasterpunkte vor dem Start weglassen; der Starttag zaehlt nur fuer
      // das Budget, zu dem er gehoert, sonst entstuenden unregelmaessige Abstaende.
      if (key < start) continue
      if (!keys.includes(key) && key !== start) continue
      trends.get(id)!.push({ date: formatDayKey(key), balance: balances.get(id) ?? 0 })
    }
  }
  return trends
}

/** Default-Zeitraum des Verlaufs: drei Monate bis heute. */
export function getDefaultHistoryRange(now: Date = new Date()): { from: Date; to: Date } {
  const to = new Date(dayKey(now))
  const from = new Date(to)
  from.setMonth(from.getMonth() - 3)
  return { from: new Date(dayKey(from)), to }
}

export const MAX_HISTORY_RANGE_DAYS = 2 * 366

export function getRangeDays(from: Date, to: Date): number {
  return Math.round((dayKey(to) - dayKey(from)) / DAY_MS)
}
