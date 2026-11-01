/*
 * PATCH /api/households/:householdId/envelopes/:id
 *
 * Aendert Name, Gruppe, Zuteilungsregel oder Sparziel eines Umschlags
 * (ADR-0005). Frequenz und Startpunkt sind unveraenderlich — ein Wechsel
 * ist ein neuer Umschlag, in den der alte geschlossen wird.
 *
 * Body (alle Felder optional): {
 *   name, group, allocationSource, allocationAmount, targetAmount, targetDate
 * }
 *
 * Erst nachbuchen, dann aendern (ADR-0005, Regel 1): Faellige Zuteilungen
 * werden vorher mit der alten Regel gebucht, die neue wirkt ab der naechsten
 * noch nicht gebuchten Periode.
 *
 * Auth: `requireHouseholdOwner` — Aendern ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseOptionalDateInput } from '../../../../utils/planning'
import { ensureAllocations } from '../../../../utils/envelope-store'
import {
  assertAllocationRule,
  parseAllocationSource,
  parseEnvelopeGroup,
  parseMoneyToCentsAllowZero,
} from '../../../../utils/envelope-lifecycle'

type UpdateEnvelopeBody = {
  name?: string
  group?: string
  allocationSource?: string
  allocationAmount?: string | number | null
  targetAmount?: string | number | null
  targetDate?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const envelopeId = parseUuidParam(event, 'id')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<UpdateEnvelopeBody>(event)) ?? {}
  const existing = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })

  const data: Prisma.EnvelopeUpdateInput = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required.' })
    data.name = name
  }
  if (body.group !== undefined) data.group = parseEnvelopeGroup(body.group)
  if (body.targetAmount !== undefined) {
    data.targetAmount = body.targetAmount === null || body.targetAmount === '' ? null : parseMoneyToCentsAllowZero(body.targetAmount, 'Target amount')
  }
  if (body.targetDate !== undefined) data.targetDate = parseOptionalDateInput(body.targetDate)

  const changesRule = body.allocationSource !== undefined || body.allocationAmount !== undefined
  if (changesRule) {
    const allocationSource = body.allocationSource === undefined ? existing.allocationSource : parseAllocationSource(body.allocationSource)
    const allocationAmount = allocationSource !== 'FIXED'
      ? null
      : body.allocationAmount === undefined
        ? existing.allocationAmount
        : body.allocationAmount === null || body.allocationAmount === ''
          ? null
          : parseMoneyToCentsAllowZero(body.allocationAmount, 'Allocation amount')
    assertAllocationRule(existing.frequency, allocationSource, allocationAmount)
    data.allocationSource = allocationSource
    data.allocationAmount = allocationAmount
    await ensureAllocations(householdId)
  }

  const item = await prisma.envelope.update({ where: { id: envelopeId }, data })
  return defineApiResponse({ kind: 'envelope', item })
})
