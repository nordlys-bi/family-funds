import { defineEventHandler, createError, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../utils/household-access'
import {
  assertFrequency,
  assertPlanningKind,
  parseDateInput,
  parseMoneyToCents,
  parseOptionalDateInput,
} from '../../../utils/planning'
import { createPlan } from '../../../utils/envelope-planning'
import { parseEnvelopeSide } from '../../../utils/envelope-transfer'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type PlanningCreateBody = {
  kind: string
  name?: string
  amount?: string | number
  frequency?: string
  startDate?: string
  endDate?: string | null
  // Issue #59 polish: optionaler Umschlag fuer Income-/FixedCost-Plan.
  // Beim "Als bezahlt/erhalten markieren"-Flow erbt die neue
  // Transaktion diesen Umschlag; ein Fixkosten-Umschlag mit Zuteilung
  // aus Plaenen (ADR-0005) teilt aus ihm zu. null = kein Umschlag.
  envelopeId?: string | null
}

// Budgets und Sparziele werden seit ADR-0005 als Umschlaege ueber
// POST .../envelopes angelegt.

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<PlanningCreateBody>(event)
  const kind = assertPlanningKind(body.kind)
  const name = body.name?.trim()

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name is required.',
    })
  }

  const item = await createPlan(householdId, kind, {
    name,
    amount: parseMoneyToCents(body.amount, 'Amount'),
    frequency: assertFrequency(body.frequency),
    startDate: parseDateInput(body.startDate, 'Start date'),
    endDate: parseOptionalDateInput(body.endDate),
    envelopeId: parseEnvelopeSide(body.envelopeId) ?? null,
  })

  return defineApiResponse({ kind, item })
})
