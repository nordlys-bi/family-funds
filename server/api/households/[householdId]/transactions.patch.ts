import { defineEventHandler, createError, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind, updateTransaction } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type TransactionUpdateBody = {
  kind: string
  id: string
  amount?: string | number
  description?: string | null
  date?: string
  // ADR-0005: Umschlag, null = "Zu verteilen". Fuer Ausgaben und Einnahmen.
  envelopeId?: string | null
  // ADR-0006: "Bezahlt mit".
  accountId?: string | null
}

/** `undefined` = nicht geaendert, `null` = kein Umschlag bzw. kein Konto. */
function parseIdChange(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  return value?.trim() || null
}

// Regeln (nur aktive Zeilen, Pruefung nur bei Aenderung von Umschlag oder
// Datum): server/utils/transactions.ts

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)
  const body = await readBody<TransactionUpdateBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transaction ID is required.',
    })
  }

  const item = await updateTransaction(householdId, kind, body.id, {
    amount: body.amount !== undefined ? parseMoneyToCents(body.amount, 'Amount') : undefined,
    date: body.date ? parseDateInput(body.date, 'Date') : undefined,
    description: body.description === undefined ? undefined : body.description?.trim() || null,
    envelopeId: parseIdChange(body.envelopeId),
    accountId: parseIdChange(body.accountId),
  })

  return defineApiResponse({ kind, item })
})
