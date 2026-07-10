import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type TransactionUpdateBody = {
  kind: string
  id: string
  amount?: string | number
  description?: string | null
  date?: string
  budgetId?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const body = await readBody<TransactionUpdateBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transaction ID is required.',
    })
  }

  const amount = body.amount !== undefined ? parseMoneyToCents(body.amount, 'Amount') : undefined
  const date = body.date ? parseDateInput(body.date, 'Date') : undefined
  const description = body.description === undefined ? undefined : body.description?.trim() || null

  if (kind === 'expense') {
    // Soft-Delete (issue #58): PATCH wirkt nur auf das aktive Set. Soft-
    // deletete Buchungen sind ueber den expliziten POST /restore zu
    // reaktivieren — PATCH ist hier bewusst 404, damit das UI nicht
    // versehentlich eine "geloeschte" Buchung mit anderen Werten
    // ueberschreibt.
    const existing = await prisma.expenseTransaction.findFirst({
      where: {
        id: body.id,
        householdId,
        deletedAt: null,
      },
    })

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Expense transaction not found.',
      })
    }

    const budgetId = body.budgetId === undefined ? undefined : body.budgetId?.trim() || null

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

    const item = await prisma.expenseTransaction.update({
      where: { id: body.id },
      data: {
        ...(amount !== undefined ? { amount } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(date ? { date } : {}),
        ...(budgetId !== undefined ? { budgetId } : {}),
      },
    })

    return defineApiResponse({ kind, item })
  }

  // Income-Pfad: gleiche Soft-Delete-Semantik.
  const existing = await prisma.incomeTransaction.findFirst({
    where: {
      id: body.id,
      householdId,
      deletedAt: null,
    },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income transaction not found.',
    })
  }

  const item = await prisma.incomeTransaction.update({
    where: { id: body.id },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(date ? { date } : {}),
    },
  })

  return defineApiResponse({ kind, item })
})
