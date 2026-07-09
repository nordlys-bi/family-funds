/*
 * POST   /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Legt eine neue Spar-Execution an. `amount` ist in Cent und darf
 * NEGATIV sein (Withdrawals). Auth: nur OWNER des Households.
 *
 * Body: { amount: number | string, date?: string (ISO) }
 */
import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../../utils/household-access'
import { parseDateInput, parseExecutionAmount } from '../../../../../utils/planning'
import { parseUuidParam } from '../../../../../utils/validation'

type CreateExecutionBody = {
  amount?: number | string
  date?: string
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const goalId = parseUuidParam(event, 'goalId')

  await requireHouseholdOwner(event, householdId)

  // Stellt sicher, dass der Goal zum Household gehoert. Verhindert
  // Cross-Household-Cross-Goal-Schreiben.
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

  const body = await readBody<CreateExecutionBody>(event)
  const amount = parseExecutionAmount(body.amount, 'Amount')
  const date = body.date ? parseDateInput(body.date, 'Date') : new Date()

  const created = await prisma.savingsGoalExecution.create({
    data: {
      savingsGoalId: goalId,
      amount,
      date,
    },
  })

  return { kind: 'execution', item: created }
})
