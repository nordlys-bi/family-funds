/*
 * DELETE /api/households/:householdId/fixed-cost-plans/:id
 *
 * Loescht einen FixedCostPlan. Path-Param ist die ID, kein `kind`-Body
 * mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdOwner`.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { deleteFixedCostPlan } from '../../../../utils/envelope-planning'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const planId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  await deleteFixedCostPlan(householdId, planId)

  return defineApiResponse({ kind: 'fixedCostPlan', deleted: true })
})
