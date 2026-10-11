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
 * Body: { amount: number | string, date?: string (ISO), note?: string,
 *         sourceBudgetId?: string | null }
 *   - `note` ist optional (issue #38, wird im History-View issue #39
 *     angezeigt). Max 500 Zeichen, sonst 400.
 *   - `sourceBudgetId` (ADR-0004): Umbuchung Budget <-> Spartopf. Positiver
 *     Betrag kommt aus dem Budget-Saldo, negativer geht dorthin zurueck.
 *     Bewusst ohne Saldo-Limit (Umbuchen ins Negative ist erlaubt) und ohne
 *     zweite Zeile — es fliesst kein Geld aus dem Haushalt ab. MEMBER duerfen
 *     das, es ist eine Buchung, keine Planung.
 */
import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseDateInput, parseExecutionAmount } from '../../../../../utils/planning'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { assertBudgetOpenOn } from '../../../../../utils/budget-lifecycle'

type CreateExecutionBody = {
  amount?: number | string
  date?: string
  note?: string
  sourceBudgetId?: string | null
}

const MAX_NOTE_LENGTH = 500

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
  const note = typeof body.note === 'string'
    ? body.note.trim().slice(0, MAX_NOTE_LENGTH) || null
    : null
  if (typeof body.note === 'string' && body.note.length > MAX_NOTE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Note must be at most ${MAX_NOTE_LENGTH} characters.`,
    })
  }

  const sourceBudgetId = typeof body.sourceBudgetId === 'string' ? body.sourceBudgetId.trim() || null : null
  if (sourceBudgetId) {
    const budget = await prisma.budget.findFirst({
      where: { id: sourceBudgetId, householdId },
      select: { id: true, closedAt: true },
    })
    if (!budget) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Budget not found.',
      })
    }
    // Keine Umbuchungen ab dem Stichtag eines geschlossenen Budgets.
    assertBudgetOpenOn(budget, date)
  }

  const created = await prisma.savingsGoalExecution.create({
    data: {
      savingsGoalId: goalId,
      amount,
      date,
      note,
      sourceBudgetId,
    },
  })

  return defineApiResponse({ kind: 'execution', item: created })
})
