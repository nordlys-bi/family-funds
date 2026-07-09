import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind } from '../../../utils/transactions'
import { parseUuidParam } from '../../../utils/validation'

type TransactionCreateBody = {
  kind: string
  amount?: string | number
  description?: string | null
  date?: string
  budgetId?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const body = await readBody<TransactionCreateBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (body.amount === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Amount is required.',
    })
  }

  if (!body.date) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Date is required.',
    })
  }

  const amount = parseMoneyToCents(body.amount, 'Amount')
  const date = parseDateInput(body.date, 'Date')
  const description = body.description?.trim() || null

  if (kind === 'expense') {
    const budgetId = body.budgetId?.trim() || null

    if (budgetId) {
      const budget = await prisma.budget.findFirst({
        where: {
          id: budgetId,
          householdId,
        },
        select: { id: true },
      })

      if (!budget) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Budget not found.',
        })
      }
    }

    const item = await prisma.expenseTransaction.create({
      data: {
        householdId,
        userId: user.id,
        amount,
        description,
        date,
        budgetId,
      },
    })

    return { kind, item }
  }

  const item = await prisma.incomeTransaction.create({
    data: {
      householdId,
      userId: user.id,
      amount,
      description,
      date,
    },
  })

  return { kind, item }
})
