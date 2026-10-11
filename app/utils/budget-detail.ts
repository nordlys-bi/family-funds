/**
 * Reine Helfer fuer die Budget-Detailseite (ADR-0004): Trend im Kopf,
 * Prognose zum Periodenende, Textzusammenfassung des Diagramms,
 * Einrasten beim Scrubbing und die nach Budgetperiode gruppierte
 * Ereignisliste.
 *
 * Alles auf `YYYY-MM-DD`-Strings und Cent-Betraegen, ohne DOM — die Seite
 * und `BudgetBalanceChart.vue` zeichnen nur noch.
 */
import type { Frequency } from '~/types/planning'
import { dayNumber, type BalancePoint } from './balance-chart'

const DAY_MS = 24 * 60 * 60 * 1000

function dayKeyFromNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return dayKeyFromNumber(dayNumber(date) + days)
}

/** Saldo am Ende des Tages `date`: letzter Punkt bis einschliesslich `date`. */
export function balanceOnDay(points: BalancePoint[], date: string): number {
  let value = points[0]?.balance ?? 0
  for (const point of points) {
    if (point.date > date) break
    value = point.balance
  }
  return value
}

/**
 * Veraenderung im gewaehlten Zeitraum fuer den Kopf ("▲ +42 € seit 11.07.").
 * Der erste Punkt ist laut API der Saldo vor `from`, der letzte der Saldo
 * am Ende von `to` — die Differenz ist also genau die Bewegung im Zeitraum.
 */
export function balanceTrendOf(points: BalancePoint[]): { since: string; delta: number } | null {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || points.length < 2) return null
  return { since: first.date, delta: last.balance - first.balance }
}

/**
 * Saldo am Periodenende, wenn die Ausgaben im bisherigen Tempo weiterlaufen:
 * heutiger Saldo minus die noch erwarteten Ausgaben dieser Periode
 * (Forecast nach ADR-0003 minus bereits Ausgegebenes). Clientseitig aus den
 * vorhandenen Listen-Daten, nichts Neues vom Server. Die Zuteilung der
 * naechsten Periode ist bewusst nicht enthalten — "Ende" heisst vor dem
 * naechsten Periodenbeginn.
 */
export function projectedPeriodEndBalance(
  balance: number,
  period: { spentAmount: number; forecast: { forecastTotal: number } | null } | null,
): number | null {
  if (!period?.forecast) return null
  return balance - Math.max(0, period.forecast.forecastTotal - period.spentAmount)
}

export type BalanceHistorySummary = {
  start: number
  end: number
  min: { balance: number; date: string }
  /** Kalendertage mit negativem Tagesend-Saldo im Zeitraum. */
  daysNegative: number
}

/**
 * Kennzahlen fuer die Screenreader-Zusammenfassung des Diagramms. Die
 * Punkte sind eine Stufenfunktion: Ein Saldo gilt von seinem Tag bis zum
 * Tag vor dem naechsten Punkt, der letzte nur fuer seinen eigenen Tag.
 */
export function summarizeBalanceHistory(points: BalancePoint[]): BalanceHistorySummary | null {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return null
  let min = { balance: first.balance, date: first.date }
  let daysNegative = 0
  points.forEach((point, index) => {
    if (point.balance < min.balance) min = { balance: point.balance, date: point.date }
    if (point.balance >= 0) return
    const next = points[index + 1]
    daysNegative += next ? dayNumber(next.date) - dayNumber(point.date) : 1
  })
  return { start: first.balance, end: last.balance, min, daysNegative }
}

/**
 * Index des Wertes, der `target` am naechsten liegt (Scrubbing rastet auf
 * den naechsten Punkt ein). Bei Gleichstand gewinnt der spaetere Punkt —
 * gleiche x-Werte entstehen, wenn der Startsaldo und ein Ereignis auf den
 * ersten Tag fallen, und dann zaehlt der Saldo nach dem Ereignis.
 */
export function nearestIndex(values: number[], target: number): number {
  let best = -1
  let bestDistance = Infinity
  values.forEach((value, index) => {
    const distance = Math.abs(value - target)
    if (distance <= bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

/**
 * Beginn der Budgetperiode, die `date` enthaelt — gleiches Raster wie der
 * Server (`startOfPeriod`): WEEKLY montags, MONTHLY zum 1., QUARTERLY zum
 * Quartalsbeginn, YEARLY zum 1.1. ONCE hat keine Unterteilung (null).
 */
export function periodStartDay(date: string, frequency: Frequency): string | null {
  const [year, month] = date.split('-').map(Number) as [number, number]
  switch (frequency) {
    case 'WEEKLY': {
      // 1970-01-01 war ein Donnerstag → (Tag + 3) % 7 = 0 fuer Montag.
      const day = dayNumber(date)
      return dayKeyFromNumber(day - ((day + 3) % 7 + 7) % 7)
    }
    case 'MONTHLY':
      return `${year}-${String(month).padStart(2, '0')}-01`
    case 'QUARTERLY':
      return `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
    case 'YEARLY':
      return `${year}-01-01`
    case 'ONCE':
      return null
  }
}

/** Beginn der Folgeperiode (exklusives Ende), null fuer ONCE. */
export function nextPeriodStartDay(start: string, frequency: Frequency): string | null {
  const [year, month] = start.split('-').map(Number) as [number, number]
  const monthsAhead = (months: number) => {
    const index = year * 12 + (month - 1) + months
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
  }
  switch (frequency) {
    case 'WEEKLY':
      return addDays(start, 7)
    case 'MONTHLY':
      return monthsAhead(1)
    case 'QUARTERLY':
      return monthsAhead(3)
    case 'YEARLY':
      return `${year + 1}-01-01`
    case 'ONCE':
      return null
  }
}

type GroupableEntry = { type: string; date: string; amount: number }

export type BalanceEntryGroup<E extends GroupableEntry> = {
  /** Periodenbeginn (bei ONCE: fruehester Eintrag) — auch der Schluessel. */
  start: string
  /** Exklusives Periodenende, null bei ONCE. */
  end: string | null
  /** Summe der Zuteilungen — stehen im Gruppenkopf statt als eigene Zeile. */
  allocation: number
  /** Alle Zugaenge inkl. Zuteilungen. */
  inflow: number
  /** Alle Abgaenge (negativ). */
  outflow: number
  /** Saldo am Periodenende bzw. am letzten Tag des Zeitraums. */
  endBalance: number
  /** Eintraege ohne Zuteilungen, neueste zuerst. */
  entries: E[]
}

/**
 * Ereignisliste nach Budgetperiode gruppiert, neueste Periode zuerst.
 * Zuteilungen wandern in den Kopf ("+400 · −312 · Ende 88 €"), weil sie
 * in jeder Periode gleich aussehen und sonst die Haelfte der Zeilen fuellen.
 *
 * Eintraege von Vorgaengern der Kette landen im Raster DIESES Budgets — die
 * Liste beantwortet "was ist in meinem Periodenraster passiert?".
 */
export function groupEntriesByPeriod<E extends GroupableEntry>(
  entries: E[],
  frequency: Frequency,
  points: BalancePoint[],
): Array<BalanceEntryGroup<E>> {
  const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date))
  const groups = new Map<string, BalanceEntryGroup<E>>()
  const onceStart = sorted[0]?.date ?? ''
  for (const entry of sorted) {
    const start = periodStartDay(entry.date, frequency) ?? onceStart
    let group = groups.get(start)
    if (!group) {
      group = {
        start,
        end: frequency === 'ONCE' ? null : nextPeriodStartDay(start, frequency),
        allocation: 0,
        inflow: 0,
        outflow: 0,
        endBalance: 0,
        entries: [],
      }
      groups.set(start, group)
    }
    if (entry.amount >= 0) group.inflow += entry.amount
    else group.outflow += entry.amount
    if (entry.type === 'allocation') group.allocation += entry.amount
    else group.entries.unshift(entry)
  }
  const lastDay = points.at(-1)?.date ?? ''
  return [...groups.values()]
    .map((group) => {
      const endDay = group.end ? addDays(group.end, -1) : lastDay
      return { ...group, endBalance: balanceOnDay(points, endDay < lastDay ? endDay : lastDay) }
    })
    .sort((left, right) => right.start.localeCompare(left.start))
}

/**
 * Startdatum fuer den Zeitraum "Alles": fruehestes `balanceSince` des Budgets
 * und aller Vorgaenger, die (auch ueber Ketten) in es geschlossen wurden —
 * der Verlauf zeigt deren Saldo vor dem Uebertrag mit. Begrenzt auf
 * `maxDays` vor `today`, weil der Server laengere Zeitraeume ablehnt.
 */
export function allHistoryFrom(
  budgetId: string,
  budgets: Array<{ id: string; balanceSince: string; carryoverToBudgetId: string | null }>,
  today: string,
  maxDays: number,
): string {
  const byTarget = new Map<string, typeof budgets>()
  for (const budget of budgets) {
    if (!budget.carryoverToBudgetId) continue
    byTarget.set(budget.carryoverToBudgetId, [...(byTarget.get(budget.carryoverToBudgetId) ?? []), budget])
  }
  const seen = new Set<string>()
  let earliest = today
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const budget = budgets.find((item) => item.id === id)
    // balanceSince kommt als ISO-Zeitpunkt (12:00 lokal); der Tag reicht.
    const since = budget ? toLocalDay(budget.balanceSince) : today
    if (since < earliest) earliest = since
    for (const predecessor of byTarget.get(id) ?? []) visit(predecessor.id)
  }
  visit(budgetId)
  const limit = addDays(today, -maxDays)
  return earliest < limit ? limit : earliest
}

function toLocalDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
