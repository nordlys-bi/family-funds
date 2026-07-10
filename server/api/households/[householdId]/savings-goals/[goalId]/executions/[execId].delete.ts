/*
 * DELETE /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Loescht eine bestehende Execution.
 *
 * Auth: jedes Mitglied des Households (MEMBER oder OWNER) darf loeschen
 * — entspricht der Domain-Semantik in CONTEXT.md (Member dürfen
 * Topf-Bewegungen erfassen und zuruecknehmen). Vor Issue #41 stand der
 * Endpoint auf `requireHouseholdOwner` und war damit asymmetrisch zum
 * korrespondierenden POST-Endpoint (Issue #36); das gleiche Argument
 * wie in `server/api/households/[householdId]/expenses/[id].delete.ts`
 * (Z. 22): "Members duerfen loeschen, weil sie auch Transaktionen
 * anlegen duerfen."
 *
 * Cross-Household-/Cross-Goal-Schutz läuft weiter über den
 * `findFirst({ id, savingsGoalId, savingsGoal.householdId })`-Lookup —
 * 404 bei Missmatch, auch für MEMBER.
 *
 * Audit: user.id landet im Request-Log (H3/Nitro loggt den Kontext) und
 * bei Bedarf im Execution-Audit-Trail. Membership-Lookup validiert
 * zugleich die Household-Zugehörigkeit.
 */
import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../../utils/validation'

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

  await prisma.savingsGoalExecution.delete({ where: { id: execId } })

  return defineApiResponse({ kind: 'execution', deleted: true })
})
