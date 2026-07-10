/*
 * DELETE /api/households/:householdId/incomes/:id
 *
 * Loescht eine Income-Transaktion. Path-Param ist die ID, kein
 * `kind`-Body mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdMembership`.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const incomeId = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)

  const existing = await prisma.incomeTransaction.findFirst({
    where: { id: incomeId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income transaction not found.',
    })
  }

  await prisma.incomeTransaction.delete({ where: { id: incomeId } })

  return defineApiResponse({ kind: 'income', deleted: true })
})