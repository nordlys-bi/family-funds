/*
 * POST /api/households/:householdId/accounts/introduction
 *
 * Fuehrt Konten ein (ADR-0006): alle starten an `date`, der Stichtag von
 * "Zu verteilen" wandert dorthin, der Startwert ergibt sich aus den Konten.
 *
 * Body: {
 *   date: 'YYYY-MM-DD' (nicht in der Zukunft, nicht vor dem bisherigen Stichtag),
 *   accounts: [{ name, type, openingBalance }] (mindestens eines),
 *   existingBookingsAccount?: Index in `accounts` — Pflicht, wenn es ab
 *     `date` schon Buchungen ohne Konto gibt; sie bekommen dieses Konto
 * }
 *
 * Auth: `requireHouseholdOwner`.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseDateInput } from '../../../../utils/planning'
import { introduceAccounts, parseAccountValues } from '../../../../utils/accounts'

type IntroductionBody = {
  date?: string
  accounts?: unknown[]
  existingBookingsAccount?: number | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<IntroductionBody>(event)) ?? {}
  if (!Array.isArray(body.accounts)) throw createError({ statusCode: 400, statusMessage: 'Accounts are required.' })
  const existing = body.existingBookingsAccount
  if (existing !== undefined && existing !== null && !Number.isInteger(existing)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account for existing bookings.' })
  }

  const items = await introduceAccounts(
    householdId,
    parseDateInput(body.date, 'Date'),
    body.accounts.map(parseAccountValues),
    existing ?? null,
  )
  return defineApiResponse({ kind: 'accounts', items })
})
