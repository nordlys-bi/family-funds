/*
 * PATCH  /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Aktualisiert eine bestehende Execution (amount, date). Nur OWNER.
 */
import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../../../utils/household-access'
import { parseDateInput, parseExecutionAmount } from '../../../../../../utils/planning'
import { parseUuidParam } from '../../../../../../utils/validation'

type UpdateExecutionBody = {
  amount?: number | string
  date?: string
}

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

  const body = await readBody<UpdateExecutionBody>(event)
  const amount =
    body.amount !== undefined ? parseExecutionAmount(body.amount, 'Amount') : undefined
  const date = body.date ? parseDateInput(body.date, 'Date') : undefined

  const item = await prisma.savingsGoalExecution.update({
    where: { id: execId },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(date !== undefined ? { date } : {}),
    },
  })

  return { kind: 'execution', item }
})
