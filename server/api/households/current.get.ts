import { defineEventHandler, createError, getCookie } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireAuthenticatedUser } from '../../utils/household-access'
import { getMonthWindow } from '../../utils/budget-evaluation'
import { computePlanCoverage, indexPaidBuckets } from '../../utils/recurring-coverage'

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)
  const activeHouseholdId = getCookie(event, 'active_household_id')

  const memberships = await prisma.householdMember.findMany({
    where: {
      userId: user.id,
    },
    select: {
      householdId: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  if (memberships.length === 0) {
    return { household: null }
  }

  const householdId = memberships.some((membership) => membership.householdId === activeHouseholdId)
    ? activeHouseholdId
    : memberships[0].householdId

  if (!householdId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Active household not found.',
    })
  }

  const household = await prisma.household.findUnique({
    where: {
      id: householdId,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      members: {
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              oidcSubject: true,
            },
          },
        },
      },
      invitations: {
        where: {
          acceptedAt: null,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          email: true,
          role: true,
          invitedBy: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      },
      incomePlans: {
        orderBy: {
          createdAt: 'desc',
        },
        // Issue #59 polish: envelopeId wird im Frontend fuer das
        // Plan-Edit-Dropdown gebraucht. select statt include, damit
        // nur das noetige Feld geladen wird.
        select: {
          id: true,
          name: true,
          amount: true,
          frequency: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          envelopeId: true,
        },
      },
      fixedCosts: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          name: true,
          amount: true,
          frequency: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          envelopeId: true,
        },
      },
    },
  })

  if (!household) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Household not found.',
    })
  }

  const { monthStart, monthEnd } = getMonthWindow()
  // Issue #59: monatliche Coverage-Berechnung fuer Income- und
  // Fixkosten-Plaene. Wir laden alle Transaktionen im aktuellen
  // Monat, die einen Plan-FK haben — eine Query pro Tabelle, dann
  // Aggregation in JS (Plan-Liste ist klein pro Household).
  const [expensePlanTx, incomePlanTx] = await Promise.all([
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        fixedCostPlanId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        date: true,
        fixedCostPlanId: true,
      },
    }),
    prisma.incomeTransaction.findMany({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        incomePlanId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        date: true,
        incomePlanId: true,
      },
    }),
  ])

  // Bucket-Index: planId -> Map<bucketKey, true>. Spart Lookup-
  // Kosten beim Transaction-Loop, weil wir nur einmal pro Bucket
  // pro Plan setzen (Mengen-Semantik).
  const paidBucketsByFixedPlan = indexPaidBuckets(
    household.fixedCosts,
    expensePlanTx.map((tx) => ({ planId: tx.fixedCostPlanId!, date: tx.date })),
    monthStart,
    monthEnd,
  )
  const paidBucketsByIncomePlan = indexPaidBuckets(
    household.incomePlans,
    incomePlanTx.map((tx) => ({ planId: tx.incomePlanId!, date: tx.date })),
    monthStart,
    monthEnd,
  )

  // `budgetId` als alter Name von `envelopeId` bis #159 (Plan-Dropdowns im
  // bestehenden UI) — migrierte Budgets haben die ID ihres Umschlags.
  const fixedCosts = household.fixedCosts.map((plan) =>
    ({ ...attachPlanCoverage(plan, paidBucketsByFixedPlan, monthStart, monthEnd), budgetId: plan.envelopeId }),
  )
  const incomePlans = household.incomePlans.map((plan) =>
    ({ ...attachPlanCoverage(plan, paidBucketsByIncomePlan, monthStart, monthEnd), budgetId: plan.envelopeId }),
  )

  // ADR-0005: Budgets, Sparziele und die Budget-Auswertung kommen nicht mehr
  // mit dem Haushaltskontext, sondern ueber GET .../envelopes.
  return {
    household: { ...household, fixedCosts, incomePlans },
  }
})

/**
 * Issue #59: packt `coverage` und `nextDueDate` an den Plan dran.
 * Wird sowohl fuer Fixed- als auch Income-Plaene aufgerufen. Die
 * Bucket-Matching-Logik liegt in `utils/recurring-coverage`
 * (geteilt mit dem Dashboard, issue #98).
 */
function attachPlanCoverage(
  plan: {
    id: string
    startDate: Date
    endDate: Date | null
    frequency: string
  },
  paidByPlan: Map<string, Set<string>>,
  monthStart: Date,
  monthEnd: Date,
) {
  const { due, paid, percent, nextDueDate } = computePlanCoverage(
    plan,
    paidByPlan,
    monthStart,
    monthEnd,
  )
  return {
    ...plan,
    coverage: { due, paid, percent },
    nextDueDate,
  }
}
