/*
 * DELETE /api/households/:householdId/savings-goals/:id
 *
 * Loescht ein SavingsGoal (inkl. aller Executions via Cascade).
 * Path-Param ist die ID, kein `kind`-Body mehr (issue #27 Finding A).
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
  const goalId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.savingsGoal.findFirst({
    where: { id: goalId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Savings goal not found.',
    })
  }

  await prisma.savingsGoal.delete({ where: { id: goalId } })

  return defineApiResponse({ kind: 'savingsGoal', deleted: true })
})