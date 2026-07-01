import type { Frequency, BudgetVersion } from '@prisma/client'

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
  versions: BudgetVersion[]
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
