/*
 * POST /api/households/:householdId/incomes/:id/restore
 *
 * Stellt eine soft-deletete Income-Transaktion wieder her (issue #58).
 * Siehe expenses/[id]/restore.post.ts fuer die vollstaendige Begruendung.
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
    where: {
      id: incomeId,
      householdId,
    },
    select: { id: true, deletedAt: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income transaction not found.',
    })
  }

  if (existing.deletedAt === null) {
    return defineApiResponse({ kind: 'income', restored: true, alreadyActive: true })
  }

  await prisma.incomeTransaction.update({
    where: { id: incomeId },
    data: { deletedAt: null },
  })

  return defineApiResponse({ kind: 'income', restored: true })
})
