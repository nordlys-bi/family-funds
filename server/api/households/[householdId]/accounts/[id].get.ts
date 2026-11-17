/*
 * GET /api/households/:householdId/accounts/:id
 *
 * Kontoverlauf (issue #191): das Konto mit Saldo von heute und alle
 * Bewegungen ab seinem Start, neueste zuerst, jeweils mit dem Saldo danach.
 *
 * Auth: `requireHouseholdMembership` — lesen duerfen alle Mitglieder.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { parseUuidParam } from '../../../../utils/validation'
import { loadAccountHistory } from '../../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  return loadAccountHistory(householdId, id)
})
