import { defineEventHandler, createError, getCookie } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireAuthenticatedUser } from '../../utils/household-access'
import { buildBudgetOverview, getMonthWindow } from '../../utils/budget-evaluation'
import { buildSavingsMonthlyProgress } from '../../utils/savings-progress'
import {
  computeCoveragePercent,
  getRecurringPeriodsInMonth,
  isDateInBucket,
} from '../../utils/recurring-periods'

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
      budgets: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          key: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: {
              validFrom: 'desc',
            },
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
      },
      incomePlans: {
        orderBy: {
          createdAt: 'desc',
        },
        // Issue #59 polish: budgetId wird im Frontend fuer das
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
          budgetId: true,
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
          budgetId: true,
        },
      },
      savingsGoals: {
        orderBy: {
          createdAt: 'desc',
        },
        // Issue #56: fuer die monatliche Plan-vs-Ist-Aggregation
        // brauchen wir pro Execution `amount` + `date`. select statt
        // include, damit wir nur die noetigen Felder laden.
        include: {
          executions: {
            select: {
              amount: true,
              date: true,
            },
          },
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

  // Aggregation: pro SavingsGoal die Summe aller Executions in Cent
  // (issue #12, erweitert in issue #56 um die monatliche
  // Plan-vs-Ist-Breakdown). Die Execution-Daten kommen jetzt direkt
  // aus dem Household-Query oben (kein separates groupBy mehr noetig),
  // das spart einen Roundtrip und haelt die Logik an einer Stelle.
  const savingsGoals = household.savingsGoals.map((goal) => {
    const currentAmount = goal.executions.reduce((sum, exec) => sum + exec.amount, 0)
    const progressPercent =
      goal.targetAmount > 0
        ? Math.min(999, Math.round((currentAmount / goal.targetAmount) * 1000) / 10)
        : 0
    return {
      ...goal,
      currentAmount,
      progressPercent,
      // Issue #56: monatliche Plan-vs-Ist-Breakdown fuer die Card.
      // Default 3 Monate (current + 2 previous). Helper uebernimmt
      // Month-Window-Berechnung und Edge-Cases (planned=0, negative
      // rate, leere executions). Siehe savings-progress.ts.
      monthlyProgress: buildSavingsMonthlyProgress(
        { monthlyRate: goal.monthlyRate, executions: goal.executions },
        3,
      ),
    }
  })

  const { monthStart, monthEnd } = getMonthWindow()
  const expenses = await prisma.expenseTransaction.findMany({
    where: {
      householdId,
      date: {
        gte: monthStart,
        lt: monthEnd,
      },
    },
    select: {
      amount: true,
      date: true,
      budgetId: true,
    },
  })

  const budgetOverview = buildBudgetOverview(household.budgets, expenses, monthStart)

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

  const fixedCosts = household.fixedCosts.map((plan) =>
    attachPlanCoverage(plan, paidBucketsByFixedPlan, monthStart, monthEnd),
  )
  const incomePlans = household.incomePlans.map((plan) =>
    attachPlanCoverage(plan, paidBucketsByIncomePlan, monthStart, monthEnd),
  )

  return {
    household: { ...household, savingsGoals, fixedCosts, incomePlans },
    budgetOverview,
  }
})

/**
 * Issue #59: baut fuer jede Plan-ID eine Set<bucketKey> der bereits
 * bezahlten Buckets. Transaktionen, die in keinen Bucket des Plans
 * im aktuellen Monat fallen, werden ignoriert (Edge Case: z. B.
 * Transaktionen mit Datum vor plan.startDate durch kaputte Daten).
 */
function indexPaidBuckets(
  plans: Array<{ id: string; startDate: Date; endDate: Date | null; frequency: string }>,
  transactions: Array<{ planId: string; date: Date }>,
  monthStart: Date,
  monthEnd: Date,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const plan of plans) {
    const { buckets } = getRecurringPeriodsInMonth(plan, monthStart.getFullYear(), monthStart.getMonth())
    const paidKeys = new Set<string>()
    for (const bucket of buckets) {
      for (const tx of transactions) {
        if (tx.planId !== plan.id) continue
        if (isDateInBucket(tx.date, bucket)) {
          paidKeys.add(bucket.key)
          break
        }
      }
    }
    result.set(plan.id, paidKeys)
  }
  return result
}

/**
 * Issue #59: packt `coverage` und `nextDueDate` an den Plan dran.
 * Wird sowohl fuer Fixed- als auch Income-Plaene aufgerufen.
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
  const { buckets, nextDueDate } = getRecurringPeriodsInMonth(
    plan,
    monthStart.getFullYear(),
    monthStart.getMonth(),
  )
  const paidKeys = paidByPlan.get(plan.id) ?? new Set<string>()
  const due = buckets.length
  const paid = paidKeys.size
  return {
    ...plan,
    coverage: {
      due,
      paid,
      percent: computeCoveragePercent(paid, due),
    },
    nextDueDate: nextDueDate ? nextDueDate.toISOString() : null,
  }
}
