/*
 * DELETE /api/households/:householdId/incomes/:id
 *
 * Soft-Delete einer Einnahme (issue #58). Die ID steht im Path, nicht im Body
 * (issue #27: DELETE mit Body wird von manchen Clients bei CORS gestrippt).
 * Regeln: `deleteTransaction` in server/utils/transactions.ts.
 *
 * Auth: `requireHouseholdMembership` — Members duerfen loeschen, weil sie
 * auch Buchungen anlegen duerfen.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { deleteTransaction } from '../../../../utils/transactions'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)
  await deleteTransaction(householdId, 'income', id)

  return defineApiResponse({ kind: 'income', deleted: true })
})
