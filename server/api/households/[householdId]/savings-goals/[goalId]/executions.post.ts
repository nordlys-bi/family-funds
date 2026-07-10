/*
 * POST   /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Legt eine neue Spar-Execution an. `amount` ist in Cent und darf
 * NEGATIV sein (Withdrawals).
 *
 * Auth: jedes Mitglied des Households (MEMBER oder OWNER) darf buchen
 * — entspricht der Domain-Semantik in CONTEXT.md (Member dürfen
 * Topf-Bewegungen erfassen). Vor Issue #36 stand der Endpoint auf
 * `requireHouseholdOwner`, was fachlich nicht zur Ausgaben-Erfassung
 * passte, mit der Members Ausgaben buchen dürfen.
 *
 * Body: { amount: number | string, date?: string (ISO) }
 */
import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseDateInput, parseExecutionAmount } from '../../../../../utils/planning'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'

type CreateExecutionBody = {
  amount?: number | string
  date?: string
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const goalId = parseUuidParam(event, 'goalId')

  // Audit: user.id landet im Request-Log (H3/Nitro loggt den Kontext) und
  // bei Bedarf im Execution-Audit-Trail. Membership-Lookup validiert zugleich
  // die Household-Zugehörigkeit.
  await requireHouseholdMembership(event, householdId)

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

  return defineApiResponse({ kind: 'execution', item: created })
})
