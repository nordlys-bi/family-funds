/*
 * DELETE /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Loescht eine bestehende Execution. Nur OWNER.
 */
import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../../../utils/household-access'
import { parseUuidParam } from '../../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const goalId = parseUuidParam(event, 'goalId')
  const execId = parseUuidParam(event, 'execId')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.savingsGoalExecution.findFirst({
    where: {
      id: execId,
      savingsGoalId: goalId,
      savingsGoal: { householdId },
    },
    select: { id: true },
  })
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Execution not found in this goal/household.',
    })
  }

  await prisma.savingsGoalExecution.delete({ where: { id: execId } })

  return { kind: 'execution', deleted: true }
})
