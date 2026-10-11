/*
 * GET /api/households/:id/budgets
 *
 * Liste der Budgets eines Households inkl. aller Versionen
 * (History-Liste fuer Planning-Pages). Auth: MEMBERSHIP.
 *
 * ADR-0004: Jedes Budget traegt seinen aktuellen Saldo (`balance`) und die
 * Felder fuer das Schliessen (`closedAt`, `carryoverToBudgetId`).
 *
 * Fuer Budget-Liste und -Detailseite ausserdem pro Budget die laufende
 * Periode inkl. Forecast (`currentPeriod`, null bei geschlossenen oder noch
 * nicht gueltigen Budgets) und der grobe Saldo-Trend der letzten 3 Monate
 * (`balanceTrend`, Wochenraster wie auf dem Dashboard). Alles aus EINER
 * Ladung der Saldo-Rohdaten — die Liste braucht so nur einen Request.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'
import { budgetBalanceSelect, loadBudgetBalanceInputs } from '../../../utils/budget-balance-query'
import { computeBudgetBalances } from '../../../utils/budget-balance'
import { computeBalanceTrends, getDefaultHistoryRange } from '../../../utils/budget-balance-history'
import { attachPeriodSpending, getCurrentBudgetPeriodWindows, withVersionFrequency } from '../../../utils/budget-evaluation'
import { buildBudgetForecast } from '../../../utils/forecast'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const budgets = await prisma.budget.findMany({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      key: true,
      name: true,
      ...budgetBalanceSelect,
      createdAt: true,
      updatedAt: true,
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
  })

  const now = new Date()
  const { expenses, transfers } = await loadBudgetBalanceInputs(householdId, budgets)
  const balances = computeBudgetBalances(budgets, expenses, transfers, now)

  const trendRange = getDefaultHistoryRange(now)
  const trends = computeBalanceTrends(
    budgets,
    expenses,
    transfers,
    budgets.map((budget) => budget.id),
    trendRange.from,
    trendRange.to,
  )

  // Laufende Periode: Die geladenen Ausgaben reichen ab dem fruehesten
  // `balanceSince`, und jede laufende Periode beginnt fruehestens dort
  // (balanceSince ist der Beginn der ersten Periode) — keine extra Query.
  const periods = new Map(
    attachPeriodSpending(getCurrentBudgetPeriodWindows(budgets.map(withVersionFrequency), now), expenses)
      .map((period) => [period.budgetId, period] as const),
  )

  return {
    budgets: budgets.map((budget) => {
      const period = periods.get(budget.id)
      return {
        ...budget,
        balance: balances.get(budget.id) ?? null,
        balanceTrend: (trends.get(budget.id) ?? []).map((point) => point.balance),
        currentPeriod: period
          ? {
              start: period.periodStart,
              end: period.periodEnd,
              plannedAmount: period.amount,
              spentAmount: period.spentAmount,
              remainingAmount: period.remainingAmount,
              percentUsed: period.percentUsed,
              severity: period.severity,
              // Forecast auf das Periodenende (ADR-0003-Formel, hier auf die
              // eigene Periode statt den Kalendermonat). ONCE ohne Ende hat
              // keinen Hochrechnungs-Zeitraum.
              forecast: period.periodEnd
                ? buildBudgetForecast(period.amount, period.spentAmount, period.periodStart, period.periodEnd, now)
                : null,
            }
          : null,
      }
    }),
  }
})
