/*
 * POST /api/households/:householdId/envelopes
 *
 * Legt einen Umschlag an (ADR-0005).
 *
 * Body: {
 *   name: string, group: EnvelopeGroup,
 *   frequency?: Frequency (Default MONTHLY, danach unveraenderlich),
 *   allocationSource?: 'NONE' | 'FIXED' | 'PLANS' (Default je Gruppe),
 *   allocationAmount?: Betrag (Pflicht bei FIXED),
 *   targetAmount?: Betrag, targetDate?: 'YYYY-MM-DD',
 *   balanceSince?: 'YYYY-MM-DD' (Default: Beginn der laufenden Periode)
 * }
 *
 * `balanceSince` muss ein Periodenbeginn sein; liegt er in der
 * Vergangenheit, werden die Zuteilungen ab dort beim naechsten Saldo-Abruf
 * nachgebucht.
 *
 * Auth: `requireHouseholdOwner` — Anlegen ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { assertFrequency, assertPeriodStart, parseDateInput, parseOptionalDateInput } from '../../../utils/planning'
import { startOfPeriod } from '../../../utils/budget-evaluation'
import {
  assertAllocationRule,
  defaultAllocationSource,
  parseAllocationSource,
  parseEnvelopeGroup,
  parseMoneyToCentsAllowZero,
} from '../../../utils/envelope-lifecycle'

type CreateEnvelopeBody = {
  name?: string
  group?: string
  frequency?: string
  allocationSource?: string
  allocationAmount?: string | number | null
  targetAmount?: string | number | null
  targetDate?: string | null
  balanceSince?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<CreateEnvelopeBody>(event)) ?? {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required.' })

  const group = parseEnvelopeGroup(body.group)
  const frequency = body.frequency === undefined ? 'MONTHLY' : assertFrequency(body.frequency)
  const allocationSource = body.allocationSource === undefined ? defaultAllocationSource[group] : parseAllocationSource(body.allocationSource)
  const allocationAmount = allocationSource === 'FIXED' && body.allocationAmount != null && body.allocationAmount !== ''
    ? parseMoneyToCentsAllowZero(body.allocationAmount, 'Allocation amount')
    : null
  assertAllocationRule(frequency, allocationSource, allocationAmount)

  const targetAmount = body.targetAmount != null && body.targetAmount !== '' ? parseMoneyToCentsAllowZero(body.targetAmount, 'Target amount') : null
  const targetDate = parseOptionalDateInput(body.targetDate)

  const balanceSince = body.balanceSince ? parseDateInput(body.balanceSince, 'Balance start') : startOfPeriod(new Date(), frequency)
  assertPeriodStart(balanceSince, frequency, 'balanceSince')

  const item = await prisma.envelope.create({
    data: { householdId, name, group, frequency, allocationSource, allocationAmount, targetAmount, targetDate, balanceSince },
  })
  return defineApiResponse({ kind: 'envelope', item })
})
