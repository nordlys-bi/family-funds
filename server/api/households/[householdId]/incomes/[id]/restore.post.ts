/*
 * POST /api/households/:householdId/incomes/:id/restore
 *
 * Stellt eine soft-geloeschte Einnahme wieder her (issue #58). Idempotent: Eine
 * aktive Buchung liefert `alreadyActive: true` ohne Aenderung. Regeln:
 * `restoreTransaction` in server/utils/transactions.ts.
 *
 * Auth: `requireHouseholdMembership`.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { restoreTransaction } from '../../../../../utils/transactions'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)
  const { alreadyActive } = await restoreTransaction(householdId, 'income', id)

  return defineApiResponse(alreadyActive ? { kind: 'income', restored: true, alreadyActive: true } : { kind: 'income', restored: true })
})
