/*
 * GET /api/households/:householdId/transfers
 *
 * Umbuchungen und gebuchte Zuteilungen (ADR-0005), neueste zuerst.
 *
 * Query (alle optional):
 *   - `?envelopeId=UUID`  nur Zeilen, an denen dieser Umschlag beteiligt ist
 *   - `?unassigned=1`     nur Zeilen mit "Zu verteilen" auf einer Seite
 *   - `?from=YYYY-MM-DD&to=YYYY-MM-DD`  Zeitraum, `to` exklusiv
 *   - `?allocations=0`    Zuteilungen ausblenden
 *
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler, getQuery } from 'h3'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseOptionalUuidQuery, parseUuidParam } from '../../../utils/validation'
import { parseDateInput } from '../../../utils/planning'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdMembership(event, householdId)

  const query = getQuery(event)
  const envelopeId = parseOptionalUuidQuery(query, 'envelopeId')
  const and: Prisma.EnvelopeTransferWhereInput[] = []
  if (envelopeId) and.push({ OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }] })
  if (query.unassigned === '1') and.push({ OR: [{ fromEnvelopeId: null }, { toEnvelopeId: null }] })
  if (query.allocations === '0') and.push({ allocationPeriodStart: null })
  if (typeof query.from === 'string' && query.from) {
    const from = parseDateInput(query.from, 'from')
    from.setHours(0, 0, 0, 0)
    and.push({ date: { gte: from } })
  }
  if (typeof query.to === 'string' && query.to) {
    const to = parseDateInput(query.to, 'to')
    to.setHours(0, 0, 0, 0)
    and.push({ date: { lt: to } })
  }

  const transfers = await prisma.envelopeTransfer.findMany({
    where: { householdId, AND: and },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      fromEnvelopeId: true,
      toEnvelopeId: true,
      amount: true,
      date: true,
      note: true,
      allocationPeriodStart: true,
      createdAt: true,
      updatedAt: true,
      fromEnvelope: { select: { name: true } },
      toEnvelope: { select: { name: true } },
      user: { select: { displayName: true } },
    },
  })
  return { transfers }
})
