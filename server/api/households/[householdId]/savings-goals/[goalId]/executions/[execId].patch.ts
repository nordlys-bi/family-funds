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
  note?: string | null
}

const MAX_NOTE_LENGTH = 500

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
  // `note` ist explizit patchbar (issue #38: User kann eine Buchung
  // nachtraeglich kommentieren). Leer-String wird zu null normalisiert.
  let note: string | null | undefined
  if (body.note !== undefined) {
    if (body.note === null) {
      note = null
    } else if (typeof body.note === 'string') {
      if (body.note.length > MAX_NOTE_LENGTH) {
        throw createError({
          statusCode: 400,
          statusMessage: `Note must be at most ${MAX_NOTE_LENGTH} characters.`,
        })
      }
      note = body.note.trim() || null
    } else {
      note = null
    }
  }

  const item = await prisma.savingsGoalExecution.update({
    where: { id: execId },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  })

  return defineApiResponse({ kind: 'execution', item })
})
