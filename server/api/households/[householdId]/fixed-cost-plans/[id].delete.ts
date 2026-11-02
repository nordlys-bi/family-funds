/*
 * DELETE /api/households/:householdId/fixed-cost-plans/:id
 *
 * Loescht einen FixedCostPlan. Path-Param ist die ID, kein `kind`-Body
 * mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdOwner`.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { ensureAllocations } from '../../../../utils/envelope-store'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const planId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.fixedCostPlan.findFirst({
    where: { id: planId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Fixed cost plan not found.',
    })
  }

  // Ein geloeschter Plan fehlt in der Zuteilung seines Fixkosten-Umschlags —
  // erst nachbuchen, dann aendern (ADR-0005, Regel 1).
  await ensureAllocations(householdId)
  await prisma.fixedCostPlan.delete({ where: { id: planId } })

  return defineApiResponse({ kind: 'fixedCostPlan', deleted: true })
})