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
import { ensureAllocations } from '../../../utils/envelope-store'
import { parsePlanEnvelope } from '../../../utils/envelope-transfer'
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
  // Alter Name bis #159.
  budgetId?: string | null
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

  switch (kind) {
    case 'incomePlan': {
      const amount = parseMoneyToCents(body.amount, 'Amount')
      const frequency = assertFrequency(body.frequency)
      const startDate = parseDateInput(body.startDate, 'Start date')
      const endDate = parseOptionalDateInput(body.endDate)
      const envelopeId = (await parsePlanEnvelope(householdId, body)) ?? null

      const item = await prisma.incomePlan.create({
        data: {
          householdId,
          name,
          amount,
          frequency,
          startDate,
          endDate,
          envelopeId,
        },
      })

      return defineApiResponse({ kind, item })
    }
    case 'fixedCostPlan': {
      const amount = parseMoneyToCents(body.amount, 'Amount')
      const frequency = assertFrequency(body.frequency)
      const startDate = parseDateInput(body.startDate, 'Start date')
      const endDate = parseOptionalDateInput(body.endDate)
      const envelopeId = (await parsePlanEnvelope(householdId, body)) ?? null

      // Ein neuer Plan aendert die Zuteilung eines Fixkosten-Umschlags —
      // erst nachbuchen, dann aendern (ADR-0005, Regel 1).
      if (envelopeId) await ensureAllocations(householdId)

      const item = await prisma.fixedCostPlan.create({
        data: {
          householdId,
          name,
          amount,
          frequency,
          startDate,
          endDate,
          envelopeId,
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
