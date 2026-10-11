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
   * Naechste Versions-Aenderung NACH der angezeigten (`current*`) Version,
   * sofern sie noch in diesem Monat beginnt — fuer den Hinweis "ab 12. Okt.
   * 300 €" in der Budgetliste. Sonst null.
   */
  nextChange: { validFrom: Date; amount: number; frequency: Frequency } | null
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
  hasPredecessor: boolean,
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

  // Eine Periode gehoert der Version, die zu ihrem Start aktiv ist (siehe
  // `findWeekVersion`). Beginnt eine Version mitten in einer Periode und
  // hat einen Vorgaenger, zaehlt diese angebrochene Periode noch zum
  // Vorgaenger — sonst wuerde sie doppelt geplant (Vorgaenger zaehlt sie
  // ueber `cursor < validTo` ohnehin mit).
  if (hasPredecessor && cursor < startOfDay(validFrom)) {
    cursor = addPeriod(cursor, frequency)
  }

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

/** Erster Wochenstart (Montag, 12:00) am oder nach `date`. */
function firstWeekStartOnOrAfter(date: Date) {
  const weekStart = startOfPeriod(date, 'WEEKLY')
  return weekStart < startOfDay(date) ? addPeriod(weekStart, 'WEEKLY') : weekStart
}

/**
 * Wochen-Zuordnung zum Monat: Eine Woche gehoert dem Monat, in dem ihr
 * MONTAG liegt — komplett, inkl. der Tage, die schon im Folgemonat liegen.
 * Eine Woche Mo 28.9. – So 4.10. gehoert also nur zum September, und die
 * Ausgaben vom 1.–4.10. zaehlen dort mit (User-Wunsch: sonst wirkt die
 * Woche in beiden Monaten nur anteilig ausgelastet).
 *
 * `start`/`end` sind Wochenstarts (Mo 12:00). Eine Ausgabe gehoert in
 * das Fenster, wenn `startOfPeriod(date, 'WEEKLY')` in `[start, end)` liegt.
 */
export function getWeeklyMonthWindow(monthStart: Date, monthEnd: Date) {
  return {
    start: firstWeekStartOnOrAfter(monthStart),
    end: firstWeekStartOnOrAfter(monthEnd),
  }
}

/**
 * Datumsbereich, den die Expense-Query fuer `buildBudgetOverview` abdecken
 * muss: Kalendermonat plus die Rest-Tage der letzten Woche, die im Monat
 * startet (siehe `getWeeklyMonthWindow`). `end` liegt auf Mitternacht, damit
 * auch Buchungen mit Uhrzeit am letzten Sonntag mitkommen.
 */
export function getBudgetExpenseQueryWindow(monthStart: Date, monthEnd: Date) {
  const weeklyEnd = new Date(getWeeklyMonthWindow(monthStart, monthEnd).end)
  weeklyEnd.setHours(0, 0, 0, 0)
  return { start: monthStart, end: weeklyEnd > monthEnd ? weeklyEnd : monthEnd }
}

/**
 * Welche Version plant die Woche ab `weekStart`? Die zum Montag aktive —
 * eine Version, die mitten in der Woche beginnt, gilt erst ab der
 * Folgewoche. Ausnahme: Es gab am Montag noch gar keine Version (Budget
 * mitten in der Woche angelegt), dann plant die erste Version, die in der
 * Woche beginnt, schon diese Woche. Gleiche Regel wie in
 * `countPeriodsInMonth`, damit Wochen-Summe und Monats-Plan uebereinstimmen.
 */
function findWeekVersion<T extends { validFrom: Date }>(versions: T[], weekStart: Date, weekEnd: Date): T | null {
  const active = findActiveVersionAt(versions, weekStart)
  if (active) return active.version
  return versions.find((version) => version.validFrom >= weekStart && version.validFrom < weekEnd) ?? null
}

/**
 * Issue #82: WEEKLY-Period-Detail.
 *
 * Listet alle Wochen, deren Montag im Monat liegt (siehe
 * `getWeeklyMonthWindow`). Pro Woche: geplant = Betrag der fuer diese
 * Woche gueltigen Version (`findWeekVersion`) — bei einer Versions-
 * Aenderung mitten im Monat zeigen die Wochen davor also noch den alten
 * Betrag. Wochen ohne WEEKLY-Version (vor der ersten Version, oder
 * Frequenzwechsel) fehlen. ausgegeben = Summe der Transaktionen mit
 * `date in [start, start+7d)`, auch wenn die Tage im Folgemonat liegen.
 *
 * `versions` muss aufsteigend nach `validFrom` sortiert sein, `expenses`
 * muss `getBudgetExpenseQueryWindow` abdecken.
 */
export function buildWeeklyPeriods<T extends { amount: number; frequency: Frequency; validFrom: Date }>(
  budgetId: string,
  versions: T[],
  expenses: ExpenseLike[],
  monthStart: Date,
  monthEnd: Date,
): PeriodOverview[] {
  const { start: firstWeekStart, end: weeksEnd } = getWeeklyMonthWindow(monthStart, monthEnd)

  // Expense-Aggregation: Map<Wochenstart-Timestamp, spentAmount>
  const expenseByWeek = new Map<number, number>()
  for (const expense of expenses) {
    if (expense.budgetId !== budgetId) continue
    const key = startOfPeriod(expense.date, 'WEEKLY').getTime()
    expenseByWeek.set(key, (expenseByWeek.get(key) ?? 0) + expense.amount)
  }

  const periods: PeriodOverview[] = []
  for (let cursor = firstWeekStart; cursor < weeksEnd; cursor = addPeriod(cursor, 'WEEKLY')) {
    const next = addPeriod(cursor, 'WEEKLY')
    const version = findWeekVersion(versions, cursor, next)
    if (!version || version.frequency !== 'WEEKLY') continue

    const spentAmount = expenseByWeek.get(cursor.getTime()) ?? 0
    const plannedAmount = version.amount
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
  }

  return periods
}

/**
 * `baseDate` waehlt nur den Monat (Endpoints uebergeben `monthStart`),
 * `today` ist der echte Stichtag fuer den Forecast. Frueher floss
 * `baseDate` auch in den Forecast — mit `monthStart` war "heute" dann
 * immer der Monatserste, `basisDays` 0 und der Forecast = Ist-Stand.
 */
export function buildBudgetOverview(
  budgets: BudgetWithVersions[],
  expenses: ExpenseLike[],
  baseDate = new Date(),
  today = new Date(),
): BudgetOverview {
  const { monthStart, monthEnd } = getMonthWindow(baseDate)
  const weeklyWindow = getWeeklyMonthWindow(monthStart, monthEnd)
  // Stichtag fuer die "aktuelle" Version: heute, auf den Monat geklemmt
  // (vergangener Monat → letzter Tag, zukuenftiger → erster Tag).
  const lastDayOfMonth = new Date(monthEnd)
  lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 1)
  const todayAtNoon = startOfDay(today)
  const referenceDate = todayAtNoon < monthStart
    ? monthStart
    : todayAtNoon > lastDayOfMonth ? lastDayOfMonth : todayAtNoon

  // `expenses` reicht ueber den Kalendermonat hinaus (bis Ende der letzten
  // Woche, die im Monat startet). Pro Budget wird erst unten entschieden,
  // welches Fenster gilt — hier nur nach Budget gruppieren.
  const isInCalendarMonth = (date: Date) => {
    const day = startOfDay(date)
    return day >= monthStart && day < monthEnd
  }
  const isInWeeklyWindow = (date: Date) => {
    const weekStart = startOfPeriod(date, 'WEEKLY')
    return weekStart >= weeklyWindow.start && weekStart < weeklyWindow.end
  }

  const expensesByBudget = new Map<string, ExpenseLike[]>()
  let unassignedSpent = 0

  for (const expense of expenses) {
    if (expense.budgetId) {
      const list = expensesByBudget.get(expense.budgetId)
      if (list) {
        list.push(expense)
      } else {
        expensesByBudget.set(expense.budgetId, [expense])
      }
    } else if (isInCalendarMonth(expense.date)) {
      unassignedSpent += expense.amount
    }
  }

  const items: BudgetOverviewItem[] = budgets.map((budget) => {
    const versions = [...budget.versions].sort((left, right) => left.validFrom.getTime() - right.validFrom.getTime())

    let plannedAmount = 0
    let periodCountTotal = 0
    const monthVersions: Array<{ version: (typeof versions)[number]; validFrom: Date; validTo: Date | null }> = []

    versions.forEach((version, index) => {
      const { validFrom, validTo } = getActiveVersionRange(versions, index)
      const periodCount = countPeriodsInMonth(validFrom, validTo, version.frequency, monthStart, monthEnd, index > 0)
      plannedAmount += periodCount * version.amount
      periodCountTotal += periodCount

      if (validFrom < monthEnd && (!validTo || validTo > monthStart)) {
        monthVersions.push({ version, validFrom, validTo })
      }
    })

    // Welche der Versionen im Monat ist die "aktuelle" (Anzeige "gültig ab",
    // Frequenz)? Die zum Stichtag gueltige — sonst zeigte ein Oktober mit
    // Aenderung ab 12.10. schon am 11.10. "gültig ab 12. Okt." (User-Report
    // 2026-10-11). Faellt der Stichtag vor die erste Version im Monat
    // (Budget beginnt erst spaeter im Monat), gilt die erste.
    const current = monthVersions.filter((entry) => entry.validFrom <= referenceDate).at(-1)
      ?? monthVersions[0]
      ?? null
    const currentAmount = current?.version.amount ?? null
    const currentFrequency = current?.version.frequency ?? null
    const currentValidFrom = current?.validFrom ?? null
    const currentValidTo = current?.validTo ?? null
    const next = current ? monthVersions[monthVersions.indexOf(current) + 1] : undefined
    const nextChange = next
      ? { validFrom: next.validFrom, amount: next.version.amount, frequency: next.version.frequency }
      : null

    // WEEKLY-Budgets rechnen in Wochen, die dem Monat ihres Montags
    // gehoeren (siehe `getWeeklyMonthWindow`) — Plan (`countPeriodsInMonth`
    // zaehlt Wochenstarts im Monat), Ausgaben und Forecast nutzen dasselbe
    // Fenster. Alle anderen Frequenzen bleiben beim Kalendermonat.
    const isWeekly = currentFrequency === 'WEEKLY'
    const isInBudgetWindow = isWeekly ? isInWeeklyWindow : isInCalendarMonth
    const budgetExpenses = (expensesByBudget.get(budget.id) ?? []).filter((expense) => isInBudgetWindow(expense.date))
    const spentAmount = budgetExpenses.reduce((sum, expense) => sum + expense.amount, 0)

    // Issue #82: WEEKLY-Budgets kriegen zusätzlich eine Period-Liste.
    // MONTHLY/QUARTERLY/YEARLY/ONCE liefern `[]` — Monats-Summe reicht
    // für die Monats-Anzeige.
    const periods = isWeekly
      ? buildWeeklyPeriods(budget.id, versions, budgetExpenses, monthStart, monthEnd)
      : []

    const forecastStart = isWeekly ? weeklyWindow.start : monthStart
    const forecastEnd = isWeekly ? weeklyWindow.end : monthEnd

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
      nextChange,
      periods,
      // Issue #60: Forecast auf Monatsende. Pure function, O(1) pro
      // Budget, keine zusätzliche DB-Query nötig — alle Eingaben sind
      // bereits im `BudgetOverviewItem`-State.
      forecast: buildBudgetForecast(plannedAmount, spentAmount, forecastStart, forecastEnd, today),
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
