/*
 * POST /api/households/:householdId/accounts
 *
 * Legt ein weiteres Konto an, nachdem die Konten eingefuehrt sind (ADR-0006).
 * Sein Anfangsbestand wird an `startDate` "Zu verteilen" gutgeschrieben.
 *
 * Body: { name, type: 'CHECKING' | 'CASH' | 'SAVINGS', openingBalance?, startDate: 'YYYY-MM-DD' }
 *
 * Auth: `requireHouseholdOwner`.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { parseDateInput } from '../../../utils/planning'
import { createAccount, parseAccountValues } from '../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const item = await createAccount(householdId, {
    ...parseAccountValues(body),
    startDate: parseDateInput(body.startDate, 'Start date'),
  })
  return defineApiResponse({ kind: 'account', item })
})
