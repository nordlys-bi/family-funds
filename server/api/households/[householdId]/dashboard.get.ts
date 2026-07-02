import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { buildBudgetOverview, getMonthWindow } from '../../../utils/budget-evaluation'
import {
  buildBudgetAlerts,
  buildRecentActivity,
  buildSavingsGoalsProgress,
} from '../../../utils/dashboard'

/**
 * GET /api/households/:householdId/dashboard
 *
 * Liefert den aggregierten Snapshot, den das Dashboard-Frontend in einer
 * einzigen Response braucht:
 *
 * - monthSummary      (Einnahmen, Ausgaben, Saldo, unassigned)
 * - budgetAlerts      (alle Budgets mit severity, sortiert; "Sonstiges" ausgenommen)
 * - recentActivity    (letzte 5 Transaktionen der letzten 7 Tage)
 * - savingsGoals      (Progress pro aktivem Sparziel, sortiert nach % to target)
 *
 * Verwendet `buildBudgetOverview` und `getMonthWindow` aus
 * `budget-evaluation.ts` (Issue-Anforderung: keine Aggregations-Duplikation).
 *
 * Auth via `requireHouseholdMembership` — nicht-authentifizierte User
 * bekommen 401, authentifizierte ohne Membership 403.
 */
export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId

  if (!householdId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID is required.',
    })
  }

  await requireHouseholdMembership(event, householdId)

  const now = new Date()
  const { monthStart, monthEnd } = getMonthWindow(now)

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  // Alle Queries parallel, damit das Endpoint sub-100ms bleibt.
  const [
    budgets,
    monthExpenses,
    monthIncomes,
    recentExpenses,
    recentIncomes,
    savingsGoals,
  ] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId },
      select: {
        id: true,
        key: true,
        name: true,
        versions: {
          orderBy: { validFrom: 'desc' },
          select: {
            id: true,
            amount: true,
            frequency: true,
            validFrom: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.expenseTransaction.findMany({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      select: { amount: true, date: true, budgetId: true },
    }),
    prisma.incomeTransaction.findMany({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      select: { amount: true },
    }),
    prisma.expenseTransaction.findMany({
      where: { householdId, date: { gte: sevenDaysAgo, lte: now } },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        budgetId: true,
        budget: { select: { name: true, key: true } },
        user: { select: { displayName: true } },
      },
    }),
    prisma.incomeTransaction.findMany({
      where: { householdId, date: { gte: sevenDaysAgo, lte: now } },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        user: { select: { displayName: true } },
      },
    }),
    prisma.savingsGoal.findMany({
      where: { householdId },
      select: {
        id: true,
        name: true,
        targetAmount: true,
        monthlyRate: true,
        executions: { select: { amount: true } },
      },
    }),
  ])

  const budgetOverview = buildBudgetOverview(budgets, monthExpenses, monthStart)

  const incomeTotal = monthIncomes.reduce((sum, transaction) => sum + transaction.amount, 0)
  const expensesTotal = monthExpenses.reduce((sum, transaction) => sum + transaction.amount, 0)

  return {
    householdId,
    monthStart,
    monthEnd,
    monthSummary: {
      income: incomeTotal,
      expenses: expensesTotal,
      balance: incomeTotal - expensesTotal,
      unassignedExpenses: budgetOverview.unassignedSpent,
    },
    budgetAlerts: buildBudgetAlerts(budgetOverview),
    recentActivity: buildRecentActivity(recentExpenses, recentIncomes, now),
    savingsGoals: buildSavingsGoalsProgress(savingsGoals),
  }
})