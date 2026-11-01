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
 * Erst nachbuchen, dann aendern (ADR-0005, Regel 1). Zuteilungen ab dem
 * Stichtag werden entfernt — die Periode gehoert nicht mehr dem Umschlag.
 * Andere Buchungen ab dem Stichtag blockieren (409): Sie gehoeren fachlich
 * schon woanders hin und muessen erst umgehaengt werden.
 *
 * Auth: `requireHouseholdOwner` — Schliessen ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { ensureAllocations } from '../../../../../utils/envelope-store'
import { assertCanCloseEnvelope } from '../../../../../utils/envelope-lifecycle'

type CloseEnvelopeBody = {
  closedAt?: string
  carryoverToEnvelopeId?: string | null
}

const closeSelect = {
  id: true,
  householdId: true,
  frequency: true,
  balanceSince: true,
  closedAt: true,
} as const

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

  const [envelope, target] = await Promise.all([
    prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: closeSelect }),
    targetId ? prisma.envelope.findFirst({ where: { id: targetId, householdId }, select: closeSelect }) : null,
  ])
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  assertCanCloseEnvelope(envelope, target, closedAt, targetId !== null)

  const closedFrom = new Date(closedAt)
  closedFrom.setHours(0, 0, 0, 0)
  const [laterExpenses, laterIncomes, laterTransfers] = await Promise.all([
    prisma.expenseTransaction.count({ where: { envelopeId, deletedAt: null, date: { gte: closedFrom } } }),
    prisma.incomeTransaction.count({ where: { envelopeId, deletedAt: null, date: { gte: closedFrom } } }),
    prisma.envelopeTransfer.count({
      where: { allocationPeriodStart: null, date: { gte: closedFrom }, OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }] },
    }),
  ])
  if (laterExpenses + laterIncomes + laterTransfers > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Envelope has bookings on or after the closing date. Move them to another envelope first.',
    })
  }

  await ensureAllocations(householdId)
  const item = await prisma.$transaction(async (tx) => {
    await tx.envelopeTransfer.deleteMany({
      where: { toEnvelopeId: envelopeId, allocationPeriodStart: { gte: closedFrom } },
    })
    return tx.envelope.update({
      where: { id: envelopeId },
      data: { closedAt, carryoverToEnvelopeId: targetId },
    })
  })
  return defineApiResponse({ kind: 'envelope', item })
})
