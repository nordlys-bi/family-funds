import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type TransactionCreateBody = {
  kind: string
  amount?: string | number
  description?: string | null
  date?: string
  budgetId?: string | null
  // Issue #59: optionaler FK auf einen Recurring-Plan, gesetzt wenn
  // der User die Transaktion ueber den "Als bezahlt markieren"-Flow
  // angelegt hat. Wird nur fuer die jeweilige Kind-Seite ausgewertet
  // (fixedCostPlanId nur fuer 'expense', incomePlanId nur fuer 'income').
  fixedCostPlanId?: string | null
  incomePlanId?: string | null
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
    const fixedCostPlanId = body.fixedCostPlanId?.trim() || null

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

    if (fixedCostPlanId) {
      const plan = await prisma.fixedCostPlan.findFirst({
        where: {
          id: fixedCostPlanId,
          householdId,
        },
        select: { id: true },
      })

      if (!plan) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fixed cost plan not found.',
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
        fixedCostPlanId,
      },
    })

    return defineApiResponse({ kind, item })
  }

  // kind === 'income'
  const incomePlanId = body.incomePlanId?.trim() || null

  if (incomePlanId) {
    const plan = await prisma.incomePlan.findFirst({
      where: {
        id: incomePlanId,
        householdId,
      },
      select: { id: true },
    })

    if (!plan) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Income plan not found.',
      })
    }
  }

  const item = await prisma.incomeTransaction.create({
    data: {
      householdId,
      userId: user.id,
      amount,
      description,
      date,
      incomePlanId,
    },
  })

  return defineApiResponse({ kind, item })
})
