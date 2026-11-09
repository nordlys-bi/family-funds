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
 * Auth: `requireHouseholdOwner` — Aendern ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseOptionalDateInput } from '../../../../utils/planning'
import { updateEnvelope, type EnvelopeChanges } from '../../../../utils/envelope-planning'
import {
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

  const changes: EnvelopeChanges = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required.' })
    changes.name = name
  }
  if (body.group !== undefined) changes.group = parseEnvelopeGroup(body.group)
  if (body.targetAmount !== undefined) {
    changes.targetAmount = body.targetAmount === null || body.targetAmount === '' ? null : parseMoneyToCentsAllowZero(body.targetAmount, 'Target amount')
  }
  if (body.targetDate !== undefined) changes.targetDate = parseOptionalDateInput(body.targetDate)
  if (body.allocationSource !== undefined) changes.allocationSource = parseAllocationSource(body.allocationSource)
  if (body.allocationAmount !== undefined) {
    changes.allocationAmount = body.allocationAmount === null || body.allocationAmount === '' ? null : parseMoneyToCentsAllowZero(body.allocationAmount, 'Allocation amount')
  }

  const item = await updateEnvelope(householdId, envelopeId, changes)
  return defineApiResponse({ kind: 'envelope', item })
})
