import type { Frequency, BudgetVersion } from '@prisma/client'
import { buildBudgetForecast, type BudgetForecast } from './forecast'

/**
 * Per-Period-Detail für ein Budget. Wird aktuell nur für WEEKLY-Budgets
 * befüllt (issue #82) — MONTHLY/QUARTERLY/YEARLY/ONCE liefern `[]`.
 *
 * Threshold für die Severity folgt der Monats-Logik (issue-spec aus
 * `server/utils/dashboard.ts`): >100% = over, >=80% = warning, sonst ok.
 * Hier berechnet, damit Frontend und Backend konsistent klassifizieren.
 */
export type PeriodSeverity = 'ok' | 'warning' | 'over'

export type PeriodOverview = {
  start: Date
  end: Date
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: PeriodSeverity
}

export type BudgetOverviewItem = {
  budgetId: string
  key: string
  name: string
  currentAmount: number | null
  currentFrequency: Frequency | null
  currentValidFrom: Date | null
  currentValidTo: Date | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  periodCount: number
  versionCount: number
  /**
   * Sub-Period-Detail. Aktuell nur für WEEKLY befüllt. Konsumenten
   * (Dashboard, Detail-Page) prüfen `currentFrequency === 'WEEKLY'`
   * oder iterieren einfach über `periods.length`.
   */
  periods: PeriodOverview[]
  /**
   * Forecast auf Monatsende (issue #60 / ADR 0003). Linear extrapoliert
   * aus `dailyRate = spent / daysSinceStart` über `daysRemaining`.
   * Siehe `server/utils/forecast.ts` für die Formel und Edge cases.
   */
  forecast: BudgetForecast
}

export type BudgetOverview = {
  monthStart: Date
  monthEnd: Date
  plannedTotal: number
  spentTotal: number
  remainingTotal: number
  unassignedSpent: number
  budgets: BudgetOverviewItem[]
  unassigned: {
    name: string
    spentAmount: number
    remainingAmount: number
  }
}

type ExpenseLike = {
  amount: number
  date: Date
  budgetId: string | null
}

type BudgetWithVersions = {
  id: string
  key: string
  name: string
  /**
   * Die Funktion braucht nur die Felder, die sie auch liest (id, amount,
   * frequency, validFrom). Prisma-Selects liefern meist einen Subset-Type
   * ohne Relations wie `budget` oder `budgetId`. `Omit` macht den Type
   * mit beiden Schreibweisen kompatibel.
   */
  versions: Array<Omit<BudgetVersion, 'budget' | 'budgetId'>>
}

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(12, 0, 0, 0)
  return value
}

export function getMonthWindow(baseDate = new Date()) {
  const monthStart = startOfDay(baseDate)
  monthStart.setDate(1)

  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  return { monthStart, monthEnd }
}

export function startOfPeriod(date: Date, frequency: Frequency) {
  const value = startOfDay(date)

  switch (frequency) {
    case 'WEEKLY': {
      const day = value.getDay()
      const offset = day === 0 ? -6 : 1 - day
      value.setDate(value.getDate() + offset)
      break
    }
    case 'MONTHLY':
      value.setDate(1)
      break
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(value.getMonth() / 3) * 3
      value.setMonth(quarterStartMonth, 1)
      break
    }
    case 'YEARLY':
      value.setMonth(0, 1)
      break
    case 'ONCE':
      break
  }

  return value
}

export function addPeriod(date: Date, frequency: Frequency) {
  const value = startOfDay(date)

  switch (frequency) {
    case 'WEEKLY':
      value.setDate(value.getDate() + 7)
      break
    case 'MONTHLY':
      value.setMonth(value.getMonth() + 1, 1)
      break
    case 'QUARTERLY':
      value.setMonth(value.getMonth() + 3, 1)
      break
    case 'YEARLY':
      value.setFullYear(value.getFullYear() + 1, 0, 1)
      break
    case 'ONCE':
      value.setTime(Number.POSITIVE_INFINITY)
      break
  }

  return value
}

function getActiveVersionRange(versions: BudgetVersion[], index: number) {
  const current = versions[index]
  const next = versions[index + 1] ?? null

  return {
    validFrom: current.validFrom,
    validTo: next?.validFrom ?? null,
  }
}

/**
 * Welche Version ist zum Zeitpunkt `at` aktiv? Anders als
 * `getActiveVersionRange` (die pro Index nur den Range zurueckgibt) sucht
 * das hier die EINE Version, deren `[validFrom, validTo)` `at` enthaelt.
 * `versions` muss aufsteigend nach `validFrom` sortiert sein.
 */
function findActiveVersionAt<T extends { validFrom: Date }>(
  versions: T[],
  at: Date,
): { version: T; validFrom: Date; validTo: Date | null } | null {
  for (let index = 0; index < versions.length; index += 1) {
    const validFrom = versions[index].validFrom
    const validTo = versions[index + 1]?.validFrom ?? null
    if (validFrom <= at && (!validTo || validTo > at)) {
      return { version: versions[index], validFrom, validTo }
    }
  }
  return null
}

/**
 * Grenzen der Periode, die `at` enthaelt, fuer eine einzelne Budget-Version.
 *
 * ONCE-Sonderfall: `addPeriod` liefert fuer ONCE absichtlich ein Invalid
 * Date (NaN-Zeit) — es gibt keine "naechste" Periode. Die Periode ist
 * daher einfach `[validFrom, validTo)`, offen falls `validTo` null ist
 * (die Version ist noch die aktuelle, kein Nachfolger hat sie beendet).
 *
 * Fuer alle anderen Frequenzen: von `startOfPeriod(validFrom, freq)` aus
 * vorwaerts laufen, bis die naechste Periode erst nach `at` beginnt. Start
 * wird auf `validFrom` geclippt (Version begann mitten in einer Periode),
 * Ende auf `validTo` (eine neuere Version hat diese vor dem natuerlichen
 * Periodenende abgeloest).
 */
function computeCurrentPeriodBounds(
  frequency: Frequency,
  validFrom: Date,
  validTo: Date | null,
  at: Date,
): { start: Date; end: Date | null } {
  if (frequency === 'ONCE') {
    return { start: startOfPeriod(validFrom, frequency), end: validTo }
  }

  let cursor = startOfPeriod(validFrom, frequency)
  let next = addPeriod(cursor, frequency)
  while (next <= at) {
    cursor = next
    next = addPeriod(cursor, frequency)
  }

  const start = cursor < validFrom ? validFrom : cursor
  const end = validTo && validTo < next ? validTo : next

  return { start, end }
}

export type BudgetCurrentPeriodWindow = {
  budgetId: string
  key: string
  name: string
  frequency: Frequency
  amount: number
  periodStart: Date
  /** null = offene Periode (ONCE, noch keine Nachfolge-Version). */
  periodEnd: Date | null
}

export type BudgetCurrentPeriodItem = BudgetCurrentPeriodWindow & {
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: PeriodSeverity
}

/**
 * Fuer jedes Budget das Zeitfenster seiner AKTUELL laufenden Periode
 * (bezogen auf die eigene Frequenz, nicht den Kalendermonat). Budgets ohne
 * zum Zeitpunkt `now` aktive Version (keine Versionen, oder die frueheste
 * `validFrom` liegt noch in der Zukunft) werden ausgeschlossen.
 *
 * Das ist die Grundlage fuer die Dashboard-Budget-Karten — im Unterschied
 * zu `buildBudgetOverview` (kalendermonats-skaliert, fuer die
 * Monats-Browsing-Detailseite) zeigt das hier fuer QUARTERLY/YEARLY/ONCE
 * immer die korrekte, volle Perioden-Planzahl statt "0 ausser im
 * Start-Monat der Periode".
 */
export function getCurrentBudgetPeriodWindows(
  budgets: BudgetWithVersions[],
  now: Date = new Date(),
): BudgetCurrentPeriodWindow[] {
  const windows: BudgetCurrentPeriodWindow[] = []

  // Auf Mittag normalisieren: `startOfPeriod`/`addPeriod` (via `startOfDay`)
  // legen jede Perioden-Grenze auf 12:00, damit die Datumsarithmetik nicht
  // in DST-Umstellungen um Mitternacht laeuft. Wuerde man das rohe `now`
  // (echte Uhrzeit) direkt gegen diese 12:00-Grenzen vergleichen, "beginnt"
  // eine neue Periode faktisch erst um 12:00 mittags statt um Mitternacht —
  // vormittags zeigt die App dann noch die vorherige Woche/Monat/etc.
  // User-Report 2026-09-14: Montag-Vormittag zeigte ein WEEKLY-Budget noch
  // KW 37 statt KW 38.
  const at = startOfDay(now)

  for (const budget of budgets) {
    const versions = [...budget.versions].sort((left, right) => left.validFrom.getTime() - right.validFrom.getTime())
    const active = findActiveVersionAt(versions, at)
    if (!active) continue

    const { version, validFrom, validTo } = active
    const { start, end } = computeCurrentPeriodBounds(version.frequency, validFrom, validTo, at)

    windows.push({
      budgetId: budget.id,
      key: budget.key,
      name: budget.name,
      frequency: version.frequency,
      amount: version.amount,
      periodStart: start,
      periodEnd: end,
    })
  }

  return windows
}

/**
 * Kleinstes/groesstes Zeitfenster ueber alle `windows` — fuer die EINE
 * Expense-Query, die alle Perioden-Karten mit Daten versorgt. `end: null`
 * sobald irgendein Fenster offen ist (ONCE ohne Nachfolger); es gibt dann
 * bewusst kein Sentinel-Datum, sondern die Query laesst das obere Ende
 * offen.
 */
export function getOverallBudgetPeriodWindow(
  windows: BudgetCurrentPeriodWindow[],
): { start: Date; end: Date | null } | null {
  if (windows.length === 0) return null

  let start = windows[0].periodStart
  let end: Date | null = windows[0].periodEnd
  let unbounded = end === null

  for (const window of windows.slice(1)) {
    if (window.periodStart < start) start = window.periodStart
    if (!unbounded) {
      if (window.periodEnd === null) {
        unbounded = true
        end = null
      } else if (end === null || window.periodEnd > end) {
        end = window.periodEnd
      }
    }
  }

  return { start, end }
}

/**
 * Reichert Perioden-Fenster mit den tatsaechlichen Ausgaben an (Ist-Stand,
 * Rest, Prozent, Severity). `expenses` muss mindestens das Fenster aus
 * `getOverallBudgetPeriodWindow` abdecken.
 */
export function attachPeriodSpending(
  windows: BudgetCurrentPeriodWindow[],
  expenses: ExpenseLike[],
): BudgetCurrentPeriodItem[] {
  const expensesByBudget = new Map<string, ExpenseLike[]>()
  for (const expense of expenses) {
    if (!expense.budgetId) continue
    const list = expensesByBudget.get(expense.budgetId)
    if (list) {
      list.push(expense)
    } else {
      expensesByBudget.set(expense.budgetId, [expense])
    }
  }

  return windows.map((window) => {
    const spentAmount = (expensesByBudget.get(window.budgetId) ?? []).reduce((sum, expense) => {
      const inRange = expense.date >= window.periodStart && (window.periodEnd === null || expense.date < window.periodEnd)
      return inRange ? sum + expense.amount : sum
    }, 0)
    const remainingAmount = window.amount - spentAmount
    const percentUsed = window.amount > 0 ? (spentAmount / window.amount) * 100 : 0

    return {
      ...window,
      spentAmount,
      remainingAmount,
      percentUsed,
      severity: classifyPeriodSeverity(percentUsed),
    }
  })
}

/**
 * Convenience-Komposition der drei Funktionen oben — primaer fuer Tests,
 * die den kompletten Pfad ohne separate Query-Planung durchspielen wollen.
 */
export function buildCurrentBudgetPeriods(
  budgets: BudgetWithVersions[],
  expenses: ExpenseLike[],
  now: Date = new Date(),
): BudgetCurrentPeriodItem[] {
  return attachPeriodSpending(getCurrentBudgetPeriodWindows(budgets, now), expenses)
}

function countPeriodsInMonth(
  validFrom: Date,
  validTo: Date | null,
  frequency: Frequency,
  monthStart: Date,
  monthEnd: Date,
) {
  if (validFrom >= monthEnd) {
    return 0
  }

  if (validTo && validTo <= monthStart) {
    return 0
  }

  if (frequency === 'ONCE') {
    return validFrom >= monthStart && validFrom < monthEnd ? 1 : 0
  }

  let cursor = startOfPeriod(validFrom, frequency)

  while (cursor < monthStart) {
    cursor = addPeriod(cursor, frequency)
  }

  let count = 0
  while (cursor < monthEnd && (!validTo || cursor < validTo)) {
    count += 1
    cursor = addPeriod(cursor, frequency)
  }

  return count
}

/**
 * Issue #82: Severity-Klassifikation für PeriodOverview.
 * Schwellwerte identisch zur Monats-Severity in `server/utils/dashboard.ts`:
 *   - >100% = over
 *   - >=80% = warning
 *   - sonst ok
 * Edge case: `plannedAmount <= 0` → 0% (harmlosester Default, konsistent
 * mit `buildSavingsGoalsProgress` in `dashboard.ts`).
 */
function classifyPeriodSeverity(percentUsed: number): PeriodSeverity {
  if (percentUsed > 100) return 'over'
  if (percentUsed >= 80) return 'warning'
  return 'ok'
}

/**
 * Issue #82: WEEKLY-Period-Detail.
 *
 * Iteriert über alle Wochen, deren Start in `[max(monthStart, currentValidFrom), monthEnd)`
 * liegt. Pro Woche: geplant = `currentAmount` (Cents), ausgegeben = Summe
 * der Transaktionen mit `date in [start, start+7d)`, remaining = geplant -
 * ausgegeben, percentUsed und severity.
 *
 * Monats-Edge-Case: Eine Woche, die am Monatsletzten startet (z.B. Mo
 * 28.7.) und am Monatsersten des Folgemonats endet (So 3.8.), wird im
 * Juli UND im August als angefangene Woche gelistet (beide Monate
 * zeigen sie; spentAmount kann in beiden Monaten verschieden sein, je
 * nachdem welche Transaktionen in welcher Wochen-Hälfte liegen). Das ist
 * die richtige Semantik für den Familien-Alltag: "was habe ich DIESE
 * Woche ausgegeben" ist unabhängig vom Monatsende.
 */
export function buildWeeklyPeriods(
  budgetId: string,
  currentAmount: number,
  currentValidFrom: Date,
  currentValidTo: Date | null,
  expenses: ExpenseLike[],
  monthStart: Date,
  monthEnd: Date,
): PeriodOverview[] {
  // Wenn die aktuelle Version erst NACH dem Monatsende gültig wird,
  // gibt es keine Perioden in diesem Monat.
  if (currentValidFrom >= monthEnd) {
    return []
  }

  // Wochen, die vor dem Monatsstart angefangen haben, interessieren nicht
  // für den Wochen-Detail — der User will Wochen sehen, die in diesem
  // Monat STARTEN. Erste anzeigbare Woche: erste Wochenstart, der >=
  // monthStart ist (oder das currentValidFrom, falls das später ist).
  const lowerBound = currentValidFrom > monthStart ? currentValidFrom : monthStart

  const firstWeekStart = startOfPeriod(lowerBound, 'WEEKLY')

  // Expense-Aggregation: pro Wochenstart die Summe.
  // Map<isoWeekStart, spentAmount>
  const expenseByWeek = new Map<number, number>()
  for (const expense of expenses) {
    if (expense.budgetId !== budgetId) continue
    // expense.date kann in einer Woche liegen, die VOR firstWeekStart
    // startet (z.B. wenn die Version später anfängt als die Transaktion).
    // Wir aggregieren trotzdem — die Wochen-Liste zeigt sie nicht, aber
    // die Monats-Summe stimmt.
    if (expense.date < firstWeekStart) continue
    const weekStart = startOfPeriod(expense.date, 'WEEKLY')
    const key = weekStart.getTime()
    expenseByWeek.set(key, (expenseByWeek.get(key) ?? 0) + expense.amount)
  }

  const periods: PeriodOverview[] = []
  let cursor = firstWeekStart
  while (cursor < monthEnd) {
    if (currentValidTo && cursor >= currentValidTo) break
    const next = addPeriod(cursor, 'WEEKLY')
    const spentAmount = expenseByWeek.get(cursor.getTime()) ?? 0
    const plannedAmount = currentAmount
    const remainingAmount = plannedAmount - spentAmount
    const percentUsed = plannedAmount > 0 ? (spentAmount / plannedAmount) * 100 : 0
    periods.push({
      start: new Date(cursor),
      end: new Date(next),
      plannedAmount,
      spentAmount,
      remainingAmount,
      percentUsed,
      severity: classifyPeriodSeverity(percentUsed),
    })
    cursor = next
  }

  return periods
}

export function buildBudgetOverview(budgets: BudgetWithVersions[], expenses: ExpenseLike[], baseDate = new Date()): BudgetOverview {
  const { monthStart, monthEnd } = getMonthWindow(baseDate)
  const expenseByBudget = new Map<string, number>()
  let unassignedSpent = 0

  for (const expense of expenses) {
    if (expense.budgetId) {
      expenseByBudget.set(expense.budgetId, (expenseByBudget.get(expense.budgetId) ?? 0) + expense.amount)
    } else {
      unassignedSpent += expense.amount
    }
  }

  const items: BudgetOverviewItem[] = budgets.map((budget) => {
    const versions = [...budget.versions].sort((left, right) => left.validFrom.getTime() - right.validFrom.getTime())

    let plannedAmount = 0
    let periodCountTotal = 0
    let currentAmount: number | null = null
    let currentFrequency: Frequency | null = null
    let currentValidFrom: Date | null = null
    let currentValidTo: Date | null = null

    versions.forEach((version, index) => {
      const { validFrom, validTo } = getActiveVersionRange(versions, index)
      const periodCount = countPeriodsInMonth(validFrom, validTo, version.frequency, monthStart, monthEnd)
      plannedAmount += periodCount * version.amount
      periodCountTotal += periodCount

      if (validFrom < monthEnd && (!validTo || validTo > monthStart)) {
        currentAmount = version.amount
        currentFrequency = version.frequency
        currentValidFrom = validFrom
        currentValidTo = validTo
      }
    })

    const spentAmount = expenseByBudget.get(budget.id) ?? 0

    // Issue #82: WEEKLY-Budgets kriegen zusätzlich eine Period-Liste.
    // MONTHLY/QUARTERLY/YEARLY/ONCE liefern `[]` — Monats-Summe reicht
    // für die Monats-Anzeige. Forecast (#60) liest später die Periods.
    const periods = currentFrequency === 'WEEKLY'
      && currentAmount !== null
      && currentValidFrom !== null
      ? buildWeeklyPeriods(
          budget.id,
          currentAmount,
          currentValidFrom,
          currentValidTo,
          expenses,
          monthStart,
          monthEnd,
        )
      : []

    return {
      budgetId: budget.id,
      key: budget.key,
      name: budget.name,
      currentAmount,
      currentFrequency,
      currentValidFrom,
      currentValidTo,
      plannedAmount,
      spentAmount,
      remainingAmount: plannedAmount - spentAmount,
      periodCount: periodCountTotal,
      versionCount: versions.length,
      periods,
      // Issue #60: Forecast auf Monatsende. Pure function, O(1) pro
      // Budget, keine zusätzliche DB-Query nötig — alle Eingaben sind
      // bereits im `BudgetOverviewItem`-State.
      forecast: buildBudgetForecast(plannedAmount, spentAmount, monthStart, monthEnd, baseDate),
    }
  })

  const plannedTotal = items.reduce((sum, item) => sum + item.plannedAmount, 0)
  const spentTotal = items.reduce((sum, item) => sum + item.spentAmount, 0) + unassignedSpent

  return {
    monthStart,
    monthEnd,
    plannedTotal,
    spentTotal,
    remainingTotal: plannedTotal - spentTotal,
    unassignedSpent,
    budgets: items,
    unassigned: {
      name: 'Sonstiges',
      spentAmount: unassignedSpent,
      remainingAmount: -unassignedSpent,
    },
  }
}
