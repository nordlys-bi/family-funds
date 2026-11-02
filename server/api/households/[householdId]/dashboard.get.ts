import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { getMonthWindow } from '../../../utils/budget-evaluation'
import { buildRecentActivity } from '../../../utils/dashboard'
import { countOpenPlans } from '../../../utils/recurring-coverage'
import { parseUuidParam } from '../../../utils/validation'
import { loadEnvelopeOverview } from '../../../utils/envelope-overview'

/**
 * GET /api/households/:householdId/dashboard
 *
 * Liefert den aggregierten Snapshot, den das Dashboard-Frontend in einer
 * einzigen Response braucht:
 *
 * - monthSummary   (Einnahmen, Ausgaben, Saldo, Ausgaben ohne Umschlag)
 * - envelopes      (alle Umschlaege mit Saldo, Periode, Bewertung nach
 *                   Saldo und Trend — dieselbe Uebersicht wie GET .../envelopes)
 * - unassigned     ("Zu verteilen": Saldo, vorgemerkt, frei)
 * - recentActivity (letzte 5 Transaktionen der letzten 7 Tage)
 * - recurringDue   (offene Fixkosten und Einnahmen des Monats)
 *
 * ADR-0005: Budget-Warnungen, Budget-Karten, Sparziel-Fortschritt und die
 * Monatsprognose ueber Budgets sind entfallen — sie ergeben sich aus
 * `envelopes` (Gruppe, `severity`, `currentPeriod`, `targetAmount`). Das
 * Dashboard-UI zieht in #157 nach.
 *
 * Auth via `requireHouseholdMembership`.
 */
export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const now = new Date()
  const { monthStart, monthEnd } = getMonthWindow(now)
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  // Alle Queries parallel; Summen DB-seitig per `_sum` (Backend-Review Finding #6).
  const [
    overview,
    monthIncomeTotal,
    monthExpenseTotal,
    monthUnassignedTotal,
    recentExpenses,
    recentIncomes,
    fixedCostPlans,
    incomePlans,
    fixedCostPlanTx,
    incomePlanTx,
  ] = await Promise.all([
    loadEnvelopeOverview(householdId, now),
    prisma.incomeTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd }, deletedAt: null },
      _sum: { amount: true },
    }),
    // Gleiche Definition wie `?unassigned=1` in der Buchungsliste:
    // Fixkosten zaehlen nicht als "ohne Umschlag".
    prisma.expenseTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd }, deletedAt: null, envelopeId: null, fixedCostPlanId: null },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.findMany({
      where: { householdId, date: { gte: sevenDaysAgo, lte: now }, deletedAt: null },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        envelopeId: true,
        envelope: { select: { name: true } },
        user: { select: { displayName: true } },
      },
    }),
    prisma.incomeTransaction.findMany({
      where: { householdId, date: { gte: sevenDaysAgo, lte: now }, deletedAt: null },
      orderBy: { date: 'desc' },
      select: { id: true, amount: true, description: true, date: true, user: { select: { displayName: true } } },
    }),
    prisma.fixedCostPlan.findMany({
      where: { householdId },
      select: { id: true, startDate: true, endDate: true, frequency: true },
    }),
    prisma.incomePlan.findMany({
      where: { householdId },
      select: { id: true, startDate: true, endDate: true, frequency: true },
    }),
    prisma.expenseTransaction.findMany({
      where: { householdId, date: { gte: monthStart, lt: monthEnd }, fixedCostPlanId: { not: null }, deletedAt: null },
      select: { date: true, fixedCostPlanId: true },
    }),
    prisma.incomeTransaction.findMany({
      where: { householdId, date: { gte: monthStart, lt: monthEnd }, incomePlanId: { not: null }, deletedAt: null },
      select: { date: true, incomePlanId: true },
    }),
  ])

  const incomeTotal = monthIncomeTotal._sum.amount ?? 0
  const expensesTotal = monthExpenseTotal._sum.amount ?? 0

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
      unassignedExpenses: monthUnassignedTotal._sum.amount ?? 0,
    },
    envelopes: overview.envelopes,
    unassigned: overview.unassigned,
    recentActivity: buildRecentActivity(
      recentExpenses.map(({ envelopeId, envelope, ...expense }) => ({ ...expense, budgetId: envelopeId, budget: envelope })),
      recentIncomes,
      now,
    ),
    recurringDue: {
      fixedCostsOpen: fixedCostDue.open,
      fixedCostsDue: fixedCostDue.due,
      incomeOpen: incomeDue.open,
      incomeDue: incomeDue.due,
    },
  }
})
