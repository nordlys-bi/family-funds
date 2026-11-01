/*
 * DELETE /api/households/:householdId/envelopes/:id
 *
 * Loescht einen Umschlag, solange er keine Spuren hat (ADR-0005 wie
 * ADR-0004): keine Ausgaben oder Einnahmen (auch soft-geloeschte — deren
 * Wiederherstellung braechte sonst eine Buchung ohne Umschlag zurueck),
 * keine Umbuchungen und kein Vorgaenger. Sonst 409, der Umschlag muss
 * geschlossen werden.
 *
 * Gebuchte Zuteilungen sind keine Spur in diesem Sinn: Sie kamen aus
 * "Zu verteilen" und fliessen mit dem Loeschen (Cascade) dorthin zurueck.
 * Sonst liesse sich ein versehentlich angelegter Umschlag mit Zuteilung
 * nie mehr loeschen.
 *
 * Auth: `requireHouseholdOwner`.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const envelopeId = parseUuidParam(event, 'id')
  await requireHouseholdOwner(event, householdId)

  const envelope = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { id: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })

  const [expenses, incomes, transfers, predecessors] = await Promise.all([
    prisma.expenseTransaction.count({ where: { envelopeId } }),
    prisma.incomeTransaction.count({ where: { envelopeId } }),
    prisma.envelopeTransfer.count({
      where: { allocationPeriodStart: null, OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }] },
    }),
    prisma.envelope.count({ where: { carryoverToEnvelopeId: envelopeId } }),
  ])
  if (expenses + incomes + transfers + predecessors > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Envelope has bookings. Close it instead of deleting it.' })
  }

  await prisma.envelope.delete({ where: { id: envelopeId } })
  return defineApiResponse({ kind: 'envelope', deleted: true })
})
