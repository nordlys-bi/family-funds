/*
 * DELETE /api/households/:householdId/account-adjustments/:id
 *
 * Nimmt einen Abgleich zurueck (issue #192). Hart geloescht: Eine Korrektur
 * zaehlt in keiner Auswertung. Fuer einen anderen Stand neu abgleichen.
 *
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { deleteAdjustment } from '../../../../utils/account-reconciliation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  await deleteAdjustment(householdId, id)
  return defineApiResponse({ kind: 'accountAdjustment', deleted: true })
})
