import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { assertTransactionKind } from '../../../utils/transactions'

type TransactionDeleteBody = {
  kind: string
  id: string
}

export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId

  if (!householdId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID is required.',
    })
  }

  await requireHouseholdMembership(event, householdId)

  const body = await readBody<TransactionDeleteBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transaction ID is required.',
    })
  }

  if (kind === 'expense') {
    const existing = await prisma.expenseTransaction.findFirst({
      where: {
        id: body.id,
        householdId,
      },
    })

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Expense transaction not found.',
      })
    }

    await prisma.expenseTransaction.delete({
      where: { id: body.id },
    })

    return { kind, deleted: true }
  }

  const existing = await prisma.incomeTransaction.findFirst({
    where: {
      id: body.id,
      householdId,
    },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income transaction not found.',
    })
  }

  await prisma.incomeTransaction.delete({
    where: { id: body.id },
  })

  return { kind, deleted: true }
})
