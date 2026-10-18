import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import {
  attachPeriodSpending,
  buildBudgetOverview,
  getCurrentBudgetPeriodWindows,
  getBudgetExpenseQueryWindow,
  getMonthWindow,
  getOverallBudgetPeriodWindow,
  withVersionFrequency,
} from '../../../utils/budget-evaluation'
import {
  buildBudgetAlerts,
  buildBudgetPeriodCards,
  buildRecentActivity,
  buildSavingsGoalsProgress,
} from '../../../utils/dashboard'
import { buildAggregatedForecast } from '../../../utils/forecast'
import { countOpenPlans } from '../../../utils/recurring-coverage'
import { parseUuidParam } from '../../../utils/validation'
import { budgetBalanceSelect, loadBudgetBalanceInputs } from '../../../utils/budget-balance-query'
import { computeBudgetBalances } from '../../../utils/budget-balance'
import { computeBalanceTrends, getDefaultHistoryRange } from '../../../utils/budget-balance-history'

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
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const now = new Date()
  const { monthStart, monthEnd } = getMonthWindow(now)
  // WEEKLY-Budgets brauchen auch die Tage der letzten Monatswoche, die schon
  // im Folgemonat liegen (Woche gehoert dem Monat ihres Montags).
  const budgetExpenseWindow = getBudgetExpenseQueryWindow(monthStart, monthEnd)

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  // Alle Queries parallel, damit das Endpoint sub-100ms bleibt.
  // monthIncomes wurde durch eine DB-seitige `_sum`-Aggregation ersetzt —
  // statt N Rows durch Node zu streamen, kommt ein einzelner Skalar
  // zurueck (Backend-Review Finding #6).
  const [
    rawBudgets,
    monthExpenses,
    monthIncomeTotal,
    recentExpenses,
    recentIncomes,
    savingsGoals,
    fixedCostPlans,
    incomePlans,
    fixedCostPlanTx,
    incomePlanTx,
  ] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId },
      select: {
        id: true,
        key: true,
        name: true,
        ...budgetBalanceSelect,
        versions: {
          orderBy: { validFrom: 'desc' },
          select: {
            id: true,
            amount: true,
            validFrom: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    // monthExpenses bleibt findMany — die Rows werden pro Budget
    // gebucketed fuer `buildBudgetOverview`. Nur der incomeTotal-
    // Reduce konnte wegoptimiert werden.
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: { gte: budgetExpenseWindow.start, lt: budgetExpenseWindow.end },
        // Soft-Delete (issue #58): nur aktive Buchungen aggregieren,
        // sonst zaehlt das Dashboard eine Buchung weiter, die der
        // User gerade geloescht hat. Issue #65.
        deletedAt: null,
      },
      select: { amount: true, date: true, budgetId: true, fixedCostPlanId: true },
    }),
    prisma.incomeTransaction.aggregate({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        deletedAt: null,
      },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: { gte: sevenDaysAgo, lte: now },
        deletedAt: null,
      },
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
      where: {
        householdId,
        date: { gte: sevenDaysAgo, lte: now },
        deletedAt: null,
      },
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
    // Issue #98: Recurring-Coverage fuer den „Handlungsbedarf"-Block.
    // Nur die Felder, die countOpenPlans braucht.
    prisma.fixedCostPlan.findMany({
      where: { householdId },
      select: { id: true, startDate: true, endDate: true, frequency: true },
    }),
    prisma.incomePlan.findMany({
      where: { householdId },
      select: { id: true, startDate: true, endDate: true, frequency: true },
    }),
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        fixedCostPlanId: { not: null },
        deletedAt: null,
      },
      select: { date: true, fixedCostPlanId: true },
    }),
    prisma.incomeTransaction.findMany({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        incomePlanId: { not: null },
        deletedAt: null,
      },
      select: { date: true, incomePlanId: true },
    }),
  ])

  const budgets = rawBudgets.map(withVersionFrequency)
  const budgetOverview = buildBudgetOverview(budgets, monthExpenses, monthStart, now)
  // ADR-0004: aktueller Saldo pro Budget fuer Alerts und Perioden-Karten.
  // Die Rohdaten werden einmal geladen und fuer Saldo UND Sparkline-Verlauf
  // genutzt — kein eigener Request/Query pro Budget.
  const balanceInputs = await loadBudgetBalanceInputs(householdId, budgets)
  const balances = computeBudgetBalances(budgets, balanceInputs.expenses, balanceInputs.transfers, now)
  const balanceOf = (budgetId: string) => balances.get(budgetId)?.balance ?? 0
  const closedBudgetIds = new Set(
    budgets.filter((budget) => budget.closedAt && budget.closedAt <= now).map((budget) => budget.id),
  )

  // Dashboard-Budget-Karten (oberste Prio, issue-request): beziehen sich
  // auf die eigene, aktuell laufende Periode jedes Budgets statt auf den
  // Kalendermonat. Braucht `budgets` aus dem Batch oben, deshalb ein
  // zusaetzlicher sequentieller Query-Hop — nur ausgefuehrt, wenn
  // ueberhaupt ein Budget gerade eine aktive Version hat.
  const periodWindows = getCurrentBudgetPeriodWindows(budgets, now)
  const overallPeriodWindow = getOverallBudgetPeriodWindow(periodWindows)

  const periodExpenses = overallPeriodWindow
    ? await prisma.expenseTransaction.findMany({
        where: {
          householdId,
          budgetId: { not: null },
          date: {
            gte: overallPeriodWindow.start,
            ...(overallPeriodWindow.end ? { lt: overallPeriodWindow.end } : {}),
          },
          deletedAt: null,
        },
        select: { amount: true, date: true, budgetId: true, fixedCostPlanId: true },
      })
    : []

  const budgetPeriodCards = buildBudgetPeriodCards(attachPeriodSpending(periodWindows, periodExpenses))

  // Sparklines: grober Wochen-Raster ueber den Default-Zeitraum (3 Monate),
  // nur fuer die Budgets, die als Karte erscheinen. Die feine Ansicht mit
  // Ereignissen liefert `.../budgets/:id/balance-history`.
  const trendRange = getDefaultHistoryRange(now)
  const balanceTrends = computeBalanceTrends(
    budgets,
    balanceInputs.expenses,
    balanceInputs.transfers,
    budgetPeriodCards.map((card) => card.budgetId),
    trendRange.from,
    trendRange.to,
  )

  const incomeTotal = monthIncomeTotal._sum.amount ?? 0
  // `monthExpenses` reicht ggf. ueber den Monat hinaus (siehe
  // `budgetExpenseWindow`) — die Monats-Summe bleibt kalendermonatlich.
  const expensesTotal = monthExpenses
    .filter((transaction) => transaction.date >= monthStart && transaction.date < monthEnd)
    .reduce((sum, transaction) => sum + transaction.amount, 0)

  // Issue #98: fällige, noch nicht (voll) gedeckte Recurring-Pläne.
  const fixedCostDue = countOpenPlans(
    fixedCostPlans,
    fixedCostPlanTx.map((tx) => ({ planId: tx.fixedCostPlanId!, date: tx.date })),
    monthStart,
    monthEnd,
  )
  const incomeDue = countOpenPlans(
    incomePlans,
    incomePlanTx.map((tx) => ({ planId: tx.incomePlanId!, date: tx.date })),
    monthStart,
    monthEnd,
  )

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
    // Geschlossene Budgets (Stichtag erreicht) sind abgeloest und gehoeren
    // nicht mehr in die Warnliste; ihr Saldo lebt im Ziel-Budget weiter.
    budgetAlerts: buildBudgetAlerts(budgetOverview)
      .filter((alert) => !closedBudgetIds.has(alert.budgetId))
      .map((alert) => ({ ...alert, balance: balanceOf(alert.budgetId) })),
    budgetPeriodCards: budgetPeriodCards.map((card) => ({
      ...card,
      balance: balanceOf(card.budgetId),
      balanceTrend: (balanceTrends.get(card.budgetId) ?? []).map((point) => point.balance),
    })),
    recentActivity: buildRecentActivity(recentExpenses, recentIncomes, now),
    savingsGoals: buildSavingsGoalsProgress(savingsGoals),
    // Issue #98: Zähler für den „Handlungsbedarf"-Block. `open` =
    // fällig diesen Monat, aber < 100 % gedeckt.
    recurringDue: {
      fixedCostsOpen: fixedCostDue.open,
      fixedCostsDue: fixedCostDue.due,
      incomeOpen: incomeDue.open,
      incomeDue: incomeDue.due,
    },
    // Issue #60 / ADR 0003: aggregierter Forecast für den month-strip.
    // Wird aus den per-Budget-Forecasts in `budgetOverview` aggregiert;
    // keine zusätzliche DB-Query nötig.
    monthForecast: buildAggregatedForecast(
      budgetOverview.budgets.map((b) => b.forecast),
      budgetOverview.plannedTotal,
    ),
  }
})