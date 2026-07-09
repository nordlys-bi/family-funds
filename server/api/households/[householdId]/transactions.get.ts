import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { getMonthWindow } from '../../../utils/budget-evaluation'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const { monthStart, monthEnd } = getMonthWindow()

  // Rows werden fuer die Listen-Darstellung gebraucht. Summen kommen
  // separat via `_sum`-Aggregates aus der DB (Backend-Review Finding #6).
  // `unassignedExpenseTotal` braucht zwei Aggregates (mit + ohne
  // budgetId-Null-Filter), beide billiger als JS-Reduce ueber N Rows.
  const [expenses, incomes, incomeTotalAggregate, expenseTotalAggregate, unassignedExpenseTotalAggregate] = await Promise.all([
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
    prisma.incomeTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.aggregate({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        budgetId: null,
      },
      _sum: { amount: true },
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

  const incomeTotal = incomeTotalAggregate._sum.amount ?? 0
  const expenseTotal = expenseTotalAggregate._sum.amount ?? 0
  const unassignedExpenseTotal = unassignedExpenseTotalAggregate._sum.amount ?? 0

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
