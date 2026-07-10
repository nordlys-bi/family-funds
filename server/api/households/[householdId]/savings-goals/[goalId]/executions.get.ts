/*
 * GET    /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Liefert die Bewegungs-History eines Sparziels (issue #39).
 *
 * Auth: jedes Mitglied des Households (MEMBER oder OWNER) darf lesen.
 * Begruendung: Die History ist mit dem Booking-Flow (issue #38)
 * symmetrisch — wer buchen darf, will auch sehen, was gebucht wurde.
 *
 * Query:
 *   - `limit` (optional, default 50, max 200): Anzahl der
 *     zurueckgegebenen Buchungen, neueste zuerst. Pagination laeuft
 *     client-seitig (einfaches "letzte 20 + Mehr laden"-Pattern, siehe
 *     `useSavingsExecutionHistory`).
 *   - `offset` (optional, default 0): Ueberspringt die ersten N
 *     Eintraege — fuer Pagination, wenn der User "Mehr laden" tippt.
 *
 * Sortierung: `date DESC, createdAt DESC` — bei gleichem Datum gewinnt
 * der juengere Eintrag, damit die Reihenfolge stabil bleibt, wenn
 * mehrere Buchungen am gleichen Tag erfolgen.
 *
 * Cross-Household-Schutz: Goal-Lookup prueft `savingsGoalId +
 * householdId` und wirft 404, wenn das Goal nicht im Haushalt liegt.
 * Das ist analog zum POST/PATCH/DELETE-Pattern.
 */
import { defineEventHandler, createError, getQuery } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

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

  const query = getQuery(event)
  let limit = DEFAULT_LIMIT
  if (query.limit !== undefined) {
    const raw = Number(query.limit)
    if (!Number.isInteger(raw) || raw < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'limit must be a positive integer.',
      })
    }
    if (raw > MAX_LIMIT) {
      throw createError({
        statusCode: 400,
        statusMessage: `limit must be at most ${MAX_LIMIT}.`,
      })
    }
    limit = raw
  }
  let offset = 0
  if (query.offset !== undefined) {
    const raw = Number(query.offset)
    if (!Number.isInteger(raw) || raw < 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'offset must be a non-negative integer.',
      })
    }
    offset = raw
  }

  const items = await prisma.savingsGoalExecution.findMany({
    where: { savingsGoalId: goalId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    skip: offset,
  })

  return defineApiResponse({ kind: 'executions', items })
})
