/*
 * POST /api/households/:householdId/expenses/:id/restore
 *
 * Stellt eine soft-geloeschte Ausgabe wieder her (issue #58). Idempotent: Eine
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
  const { alreadyActive } = await restoreTransaction(householdId, 'expense', id)

  return defineApiResponse(alreadyActive ? { kind: 'expense', restored: true, alreadyActive: true } : { kind: 'expense', restored: true })
})
