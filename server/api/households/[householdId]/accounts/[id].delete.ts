/*
 * DELETE /api/households/:householdId/accounts/:id
 *
 * Nur ein Konto ohne Buchungen und nicht das letzte (ADR-0006). Sonst 409,
 * das Konto muss geschlossen werden.
 *
 * Auth: `requireHouseholdOwner`.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { deleteAccount } from '../../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdOwner(event, householdId)

  await deleteAccount(householdId, id)
  return defineApiResponse({ kind: 'account', deleted: true })
})
