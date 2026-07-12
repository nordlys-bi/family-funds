import { defineEventHandler, createError, getCookie } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireAuthenticatedUser } from '../../utils/household-access'
import { buildBudgetOverview, getMonthWindow } from '../../utils/budget-evaluation'
import { buildSavingsMonthlyProgress } from '../../utils/savings-progress'

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
      },
      fixedCosts: {
        orderBy: {
          createdAt: 'desc',
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

  return {
    household: { ...household, savingsGoals },
    budgetOverview,
  }
})
