import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { getMonthWindow } from '../../../utils/budget-evaluation'

export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId

  if (!householdId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID is required.',
    })
  }

  const { user } = await requireHouseholdMembership(event, householdId)
  const { monthStart, monthEnd } = getMonthWindow()

  const [expenses, incomes] = await Promise.all([
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
      orderBy: {
        date: 'desc',
      },
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        createdAt: true,
        updatedAt: true,
        budgetId: true,
        budget: {
          select: {
            id: true,
            name: true,
            key: true,
          },
        },
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    }),
    prisma.incomeTransaction.findMany({
      where: {
        householdId,
        date: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
      orderBy: {
        date: 'desc',
      },
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    }),
  ])

  const transactions = [
    ...expenses.map((transaction) => ({
      id: transaction.id,
      kind: 'expense' as const,
      amount: transaction.amount,
      description: transaction.description,
      date: transaction.date,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      budgetId: transaction.budgetId,
      budgetName: transaction.budget?.name ?? null,
      budgetKey: transaction.budget?.key ?? null,
      user: transaction.user,
    })),
    ...incomes.map((transaction) => ({
      id: transaction.id,
      kind: 'income' as const,
      amount: transaction.amount,
      description: transaction.description,
      date: transaction.date,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      user: transaction.user,
    })),
  ].sort((left, right) => right.date.getTime() - left.date.getTime())

  const incomeTotal = incomes.reduce((sum, transaction) => sum + transaction.amount, 0)
  const expenseTotal = expenses.reduce((sum, transaction) => sum + transaction.amount, 0)
  const unassignedExpenseTotal = expenses.filter((transaction) => !transaction.budgetId).reduce((sum, transaction) => sum + transaction.amount, 0)

  return {
    householdId,
    monthStart,
    monthEnd,
    transactions,
    summary: {
      incomeTotal,
      expenseTotal,
      netTotal: incomeTotal - expenseTotal,
      unassignedExpenseTotal,
      visibleForUserId: user.id,
    },
  }
})
