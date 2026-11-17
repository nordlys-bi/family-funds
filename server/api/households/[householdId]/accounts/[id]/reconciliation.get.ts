/*
 * GET /api/households/:householdId/accounts/:id/reconciliation?date=YYYY-MM-DD
 *
 * Berechneter Kontostand am Ende des Tages (issue #192): die Vergleichsbasis
 * im Abgleich-Dialog. Der Server rechnet, damit Dialog und Ausbuchen
 * dieselbe Zahl sehen.
 *
 * Auth: `requireHouseholdMembership`.
 */
import { defineEventHandler, getQuery } from 'h3'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { computedAccountBalance } from '../../../../../utils/account-reconciliation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const accountId = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  const date = parseDateInput(getQuery(event).date, 'Date')
  const { balance } = await computedAccountBalance(householdId, accountId, date)
  return { date, computedBalance: balance }
})
