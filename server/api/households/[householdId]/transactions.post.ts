import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { assertBookingEnvelope } from '../../../utils/envelope-transfer'

type TransactionCreateBody = {
  kind: string
  amount?: string | number
  description?: string | null
  date?: string
  // ADR-0005: Umschlag der Buchung, null = "Zu verteilen". Auch fuer
  // Einnahmen (Gutschrift auf einen Umschlag).
  envelopeId?: string | null
  // Alter Name bis zur neuen Erfassung (#156) — die IDs migrierter Budgets
  // sind die ihrer Umschlaege. Nur fuer Ausgaben ausgewertet.
  budgetId?: string | null
  // Issue #59: optionaler FK auf einen Recurring-Plan, gesetzt wenn
  // der User die Transaktion ueber den "Als bezahlt markieren"-Flow
  // angelegt hat. Wird nur fuer die jeweilige Kind-Seite ausgewertet
  // (fixedCostPlanId nur fuer 'expense', incomePlanId nur fuer 'income').
  fixedCostPlanId?: string | null
  incomePlanId?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const body = await readBody<TransactionCreateBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (body.amount === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Amount is required.',
    })
  }

  if (!body.date) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Date is required.',
    })
  }

  const amount = parseMoneyToCents(body.amount, 'Amount')
  const date = parseDateInput(body.date, 'Date')
  const description = body.description?.trim() || null

  if (kind === 'expense') {
    const fixedCostPlanId = body.fixedCostPlanId?.trim() || null
    let envelopeId = (body.envelopeId ?? body.budgetId)?.trim() || null

    if (fixedCostPlanId) {
      const plan = await prisma.fixedCostPlan.findFirst({
        where: {
          id: fixedCostPlanId,
          householdId,
        },
        select: { id: true, envelopeId: true },
      })

      if (!plan) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fixed cost plan not found.',
        })
      }

      // Issue #59 polish (Option c, hart gekoppelt): wenn der Plan
      // einen Umschlag hat, erbt die Transaktion diesen Umschlag.
      // Per-Transaction-Override ist nicht vorgesehen — wer das
      // nachtraeglich aendern will, nutzt den Transaction-Row-Editor.
      if (plan.envelopeId && !envelopeId) {
        envelopeId = plan.envelopeId
      }
    }

    // ADR-0005: keine Buchungen ab dem Stichtag eines geschlossenen Umschlags.
    await assertBookingEnvelope(householdId, envelopeId, date)

    const item = await prisma.expenseTransaction.create({
      data: {
        householdId,
        userId: user.id,
        amount,
        description,
        date,
        envelopeId,
        fixedCostPlanId,
      },
    })

    return defineApiResponse({ kind, item })
  }

  // kind === 'income'
  //
  // ADR-0005: Eine Einnahme kann einem Umschlag gutgeschrieben werden
  // (Verkauf → Kinder), sonst geht sie nach "Zu verteilen". Nur
  // `envelopeId` zaehlt — `budgetId` bleibt bei Einnahmen bewusst
  // ignoriert (issue #105: das alte UI schickt dort Ausgaben-Budgets mit).
  const incomePlanId = body.incomePlanId?.trim() || null
  let envelopeId = body.envelopeId?.trim() || null

  if (incomePlanId) {
    const plan = await prisma.incomePlan.findFirst({
      where: {
        id: incomePlanId,
        householdId,
      },
      select: { id: true, envelopeId: true },
    })

    if (!plan) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Income plan not found.',
      })
    }

    // Wie bei Fixkosten: Eine Einnahme aus einem Plan mit Umschlag wird
    // diesem gutgeschrieben (Kindergeld → Kinder).
    if (plan.envelopeId && !envelopeId) {
      envelopeId = plan.envelopeId
    }
  }

  await assertBookingEnvelope(householdId, envelopeId, date)

  const item = await prisma.incomeTransaction.create({
    data: {
      householdId,
      userId: user.id,
      amount,
      description,
      date,
      incomePlanId,
      envelopeId,
    },
  })

  return defineApiResponse({ kind, item })
})
