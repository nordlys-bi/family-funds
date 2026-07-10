/*
 * DELETE /api/households/:householdId/income-plans/:id
 *
 * Loescht einen IncomePlan. Path-Param ist die ID, kein `kind`-Body
 * mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdOwner`.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const planId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.incomePlan.findFirst({
    where: { id: planId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income plan not found.',
    })
  }

  await prisma.incomePlan.delete({ where: { id: planId } })

  return defineApiResponse({ kind: 'incomePlan', deleted: true })
})