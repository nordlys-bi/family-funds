/*
 * DELETE /api/households/:householdId/account-transfers/:id
 *
 * Loescht einen Kontouebertrag hart (issue #191): Er taucht in keiner
 * Auswertung auf, ein Audit-Trail wie bei Ausgaben ist nicht noetig.
 *
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { deleteAccountTransfer } from '../../../../utils/account-transfers'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  await deleteAccountTransfer(householdId, id)
  return defineApiResponse({ kind: 'accountTransfer', deleted: true })
})
