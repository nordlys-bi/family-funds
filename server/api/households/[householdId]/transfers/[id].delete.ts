/*
 * DELETE /api/households/:householdId/transfers/:id
 *
 * Loescht eine gewoehnliche Umbuchung (hart — Umbuchungen tauchen in keinem
 * Report auf, ein Audit-Trail wie bei Ausgaben ist nicht noetig).
 * Zuteilungen lassen sich nicht loeschen, nur auf 0 setzen (ADR-0005,
 * Regel 3), sonst wuerden sie beim naechsten Abruf neu gebucht.
 *
 * Auth: MEMBERSHIP.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const transferId = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  const existing = await prisma.envelopeTransfer.findFirst({
    where: { id: transferId, householdId },
    select: { allocationPeriodStart: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Transfer not found.' })
  if (existing.allocationPeriodStart) {
    throw createError({ statusCode: 400, statusMessage: 'Allocations cannot be deleted. Set the amount to 0 instead.' })
  }

  await prisma.envelopeTransfer.delete({ where: { id: transferId } })
  return defineApiResponse({ kind: 'transfer', deleted: true })
})
