/*
 * POST /api/households/:householdId/account-transfers
 *
 * Bucht einen Kontouebertrag (ADR-0006, issue #191): Geld abheben, Sparrate
 * aufs Tagesgeld. Beruehrt keinen Umschlag und zaehlt in keiner Auswertung.
 *
 * Body: { fromAccountId, toAccountId, amount: Betrag > 0, date: 'YYYY-MM-DD', note? }
 *
 * Auth: MEMBERSHIP — ein Uebertrag ist eine Buchung, keine Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { createAccountTransfer } from '../../../utils/account-transfers'

type CreateAccountTransferBody = {
  fromAccountId?: unknown
  toAccountId?: unknown
  amount?: string | number
  date?: string
  note?: unknown
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const { user } = await requireHouseholdMembership(event, householdId)

  const body = (await readBody<CreateAccountTransferBody>(event)) ?? {}
  if (typeof body.fromAccountId !== 'string' || !body.fromAccountId || typeof body.toAccountId !== 'string' || !body.toAccountId) {
    throw createError({ statusCode: 400, statusMessage: 'fromAccountId and toAccountId are required.' })
  }

  const item = await createAccountTransfer(householdId, user.id, {
    fromAccountId: body.fromAccountId,
    toAccountId: body.toAccountId,
    amount: parseMoneyToCents(body.amount, 'Amount'),
    date: parseDateInput(body.date, 'Date'),
    note: typeof body.note === 'string' ? body.note.trim() || null : null,
  })
  return defineApiResponse({ kind: 'accountTransfer', item })
})
