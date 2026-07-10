/*
 * DELETE /api/households/:householdId/budgets/:id
 *
 * Loescht ein Budget (inkl. aller Versionen via Cascade). Path-Param
 * ist die ID, kein `kind`-Body mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdOwner` — nur Owner duerfen Planning-Items
 * verwalten.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const budgetId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.budget.findFirst({
    where: { id: budgetId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Budget not found.',
    })
  }

  await prisma.budget.delete({ where: { id: budgetId } })

  return defineApiResponse({ kind: 'budget', deleted: true })
})