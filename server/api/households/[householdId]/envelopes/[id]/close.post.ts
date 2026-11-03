/*
 * POST /api/households/:householdId/envelopes/:id/close
 *
 * Schliesst einen Umschlag zu einem Stichtag (ADR-0005, wie ADR-0004).
 * Der Endsaldo fliesst als Verweis in einen anderen Umschlag oder — neu —
 * nach "Zu verteilen", z.B. um ein erreichtes Sparziel aufzuloesen.
 *
 * Body: { closedAt: 'YYYY-MM-DD', carryoverToEnvelopeId: string | null }
 *   null = "Zu verteilen"; das Feld ist Pflicht, damit "kein Ziel" eine
 *   bewusste Wahl ist und kein vergessener Parameter.
 *
 * Regeln und Reihenfolge liegen in `closeEnvelope` (`envelope-planning.ts`).
 *
 * Auth: `requireHouseholdOwner` — Schliessen ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { closeEnvelope } from '../../../../../utils/envelope-planning'

type CloseEnvelopeBody = {
  closedAt?: string
  carryoverToEnvelopeId?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const envelopeId = parseUuidParam(event, 'id')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<CloseEnvelopeBody>(event)) ?? {}
  const closedAt = parseDateInput(body.closedAt, 'Closing date')
  if (body.carryoverToEnvelopeId === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'carryoverToEnvelopeId is required (null = "Zu verteilen").' })
  }
  const targetId = typeof body.carryoverToEnvelopeId === 'string' ? body.carryoverToEnvelopeId.trim() || null : null

  const item = await closeEnvelope(householdId, envelopeId, closedAt, targetId)
  return defineApiResponse({ kind: 'envelope', item })
})
