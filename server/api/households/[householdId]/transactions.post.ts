import { defineEventHandler, createError, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind, createTransaction } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type TransactionCreateBody = {
  kind: string
  amount?: string | number
  description?: string | null
  date?: string
  // ADR-0005: Umschlag der Buchung, null = "Zu verteilen". Auch fuer
  // Einnahmen (Gutschrift auf einen Umschlag).
  envelopeId?: string | null
  // ADR-0006: "Bezahlt mit"; Pflicht ab ledgerSince, sobald es Konten gibt.
  accountId?: string | null
  // Issue #59: optionaler FK auf einen Recurring-Plan, gesetzt wenn
  // der User die Transaktion ueber den "Als bezahlt markieren"-Flow
  // angelegt hat. Wird nur fuer die jeweilige Kind-Seite ausgewertet
  // (fixedCostPlanId nur fuer 'expense', incomePlanId nur fuer 'income').
  fixedCostPlanId?: string | null
  incomePlanId?: string | null
}

// Regeln (Umschlag vom Plan, Stichtag, Startpunkt): server/utils/transactions.ts

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

  const planId = kind === 'expense' ? body.fixedCostPlanId : body.incomePlanId

  const item = await createTransaction(householdId, user.id, kind, {
    amount: parseMoneyToCents(body.amount, 'Amount'),
    date: parseDateInput(body.date, 'Date'),
    description: body.description?.trim() || null,
    envelopeId: body.envelopeId?.trim() || null,
    planId: planId?.trim() || null,
    accountId: body.accountId?.trim() || null,
  })

  return defineApiResponse({ kind, item })
})
