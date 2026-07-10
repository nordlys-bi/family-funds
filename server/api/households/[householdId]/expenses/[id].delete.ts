/*
 * DELETE /api/households/:householdId/expenses/:id
 *
 * Loescht eine Expense-Transaktion. Path-Param ist die ID, kein
 * `kind`-Body mehr (issue #27 Finding A — DELETE mit JSON-Body
 * verstoesst gegen REST-Idempotenz und wird von manchen fetch-Clients
 * bei CORS gestrippt).
 *
 * Auth: `requireHouseholdMembership` — Members duerfen loeschen,
 * weil sie auch Transaktionen anlegen duerfen.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const expenseId = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)

  const existing = await prisma.expenseTransaction.findFirst({
    where: { id: expenseId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Expense transaction not found.',
    })
  }

  await prisma.expenseTransaction.delete({ where: { id: expenseId } })

  return defineApiResponse({ kind: 'expense', deleted: true })
})