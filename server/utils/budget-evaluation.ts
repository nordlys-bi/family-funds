import type { Frequency, BudgetVersion } from '@prisma/client'

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
