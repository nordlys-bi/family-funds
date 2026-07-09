/*
 * GET    /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Liefert alle Executions eines Goals (History). Auth: MEMBERSHIP.
 */
import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseUuidParam } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const goalId = parseUuidParam(event, 'goalId')

  await requireHouseholdMembership(event, householdId)

  const goal = await prisma.savingsGoal.findFirst({
    where: { id: goalId, householdId },
    select: { id: true },
  })
  if (!goal) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Savings goal not found in this household.',
    })
  }

  const executions = await prisma.savingsGoalExecution.findMany({
    where: { savingsGoalId: goalId },
    orderBy: { date: 'desc' },
  })

  return { executions }
})
