import { defineEventHandler, createError, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../utils/household-access'
import {
  assertFrequency,
  assertPlanningKind,
  parseDateInput,
  parseMoneyToCents,
  parseOptionalDateInput,
} from '../../../utils/planning'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { updatePlan } from '../../../utils/envelope-planning'
import { parseEnvelopeSide } from '../../../utils/envelope-transfer'

type PlanningUpdateBody = {
  kind: string
  id: string
  name?: string
  amount?: string | number
  frequency?: string
  startDate?: string
  endDate?: string | null
  // Issue #59 polish: optionaler Umschlag fuer Income-/FixedCost-Plan.
  // null = explizit kein Umschlag (vs. nicht gesetzt = aktueller Wert
  // bleibt). Beim "Als bezahlt/erhalten markieren"-Flow erbt die
  // neue Transaktion diesen Umschlag.
  envelopeId?: string | null
}

// Budgets und Sparziele werden seit ADR-0005 ueber PATCH .../envelopes/:id
// geaendert.

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<PlanningUpdateBody>(event)
  const kind = assertPlanningKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Item ID is required.',
    })
  }

  const name = body.name?.trim()

  const item = await updatePlan(householdId, kind, body.id, {
    ...(name ? { name } : {}),
    ...(body.amount !== undefined ? { amount: parseMoneyToCents(body.amount, 'Amount') } : {}),
    ...(body.frequency ? { frequency: assertFrequency(body.frequency) } : {}),
    ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
    ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
    envelopeId: parseEnvelopeSide(body.envelopeId),
  })

  return defineApiResponse({ kind, item })
})
