/*
 * PATCH  /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Aktualisiert eine bestehende Execution (amount, date).
 *
 * Auth: jedes Mitglied des Households (MEMBER oder OWNER) darf patchen
 * — entspricht der Domain-Semantik in CONTEXT.md (Member dürfen
 * Topf-Bewegungen erfassen und korrigieren). Vor Issue #41 stand der
 * Endpoint auf `requireHouseholdOwner` und war damit asymmetrisch zum
 * korrespondierenden POST-Endpoint (Issue #36), was dazu führte, dass
 * Members eine selbst gebuchte Buchung nicht mehr korrigieren konnten.
 *
 * Cross-Household-/Cross-Goal-Schutz läuft weiter über den
 * `findFirst({ id, savingsGoalId, savingsGoal.householdId })`-Lookup —
 * 404 bei Missmatch, auch für MEMBER.
 *
 * Audit: user.id landet im Request-Log (H3/Nitro loggt den Kontext) und
 * bei Bedarf im Execution-Audit-Trail. Membership-Lookup validiert
 * zugleich die Household-Zugehörigkeit — dasselbe Argument wie in
 * `executions.post.ts`.
 */
import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../../utils/household-access'
import { parseDateInput, parseExecutionAmount } from '../../../../../../utils/planning'
import { defineApiResponse } from '../../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../../utils/validation'

type UpdateExecutionBody = {
  amount?: number | string
  date?: string
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const goalId = parseUuidParam(event, 'goalId')
  const execId = parseUuidParam(event, 'execId')

  // Audit: user.id landet im Request-Log (H3/Nitro loggt den Kontext) und
  // bei Bedarf im Execution-Audit-Trail. Membership-Lookup validiert zugleich
  // die Household-Zugehörigkeit.
  await requireHouseholdMembership(event, householdId)

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

  return defineApiResponse({ kind: 'execution', item })
})
