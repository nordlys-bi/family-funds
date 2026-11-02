import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
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
import { ensureAllocations } from '../../../utils/envelope-store'
import { parsePlanEnvelope } from '../../../utils/envelope-transfer'

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
  // Alter Name bis #159.
  budgetId?: string | null
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

  switch (kind) {
    case 'incomePlan': {
      const existing = await prisma.incomePlan.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Income plan not found.',
        })
      }

      // Umschlag muss zum Haushalt gehoeren; undefined = nicht aendern,
      // null = explizit kein Umschlag.
      const envelopeId = await parsePlanEnvelope(householdId, body)

      const item = await prisma.incomePlan.update({
        where: { id: body.id },
        data: {
          ...(name ? { name } : {}),
          ...(body.amount !== undefined ? { amount: parseMoneyToCents(body.amount, 'Amount') } : {}),
          ...(body.frequency ? { frequency: assertFrequency(body.frequency) } : {}),
          ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
          ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
          ...(envelopeId !== undefined ? { envelopeId } : {}),
        },
      })

      return defineApiResponse({ kind, item })
    }
    case 'fixedCostPlan': {
      const existing = await prisma.fixedCostPlan.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fixed cost plan not found.',
        })
      }

      const envelopeId = await parsePlanEnvelope(householdId, body)

      // Betrag, Frequenz, Laufzeit und Umschlag bestimmen die Zuteilung
      // eines Fixkosten-Umschlags — erst nachbuchen, dann aendern
      // (ADR-0005, Regel 1), damit die Aenderung erst ab der naechsten
      // noch nicht gebuchten Periode wirkt.
      if (existing.envelopeId || envelopeId) await ensureAllocations(householdId)

      const item = await prisma.fixedCostPlan.update({
        where: { id: body.id },
        data: {
          ...(name ? { name } : {}),
          ...(body.amount !== undefined ? { amount: parseMoneyToCents(body.amount, 'Amount') } : {}),
          ...(body.frequency ? { frequency: assertFrequency(body.frequency) } : {}),
          ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
          ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
          ...(envelopeId !== undefined ? { envelopeId } : {}),
        },
      })

      return defineApiResponse({ kind, item })
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported planning kind.',
      })
  }
})
