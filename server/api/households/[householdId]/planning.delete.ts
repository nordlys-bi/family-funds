/*
 * DEPRECATED (issue #27): DELETE /api/households/:householdId/planning
 *
 * Liefert ab Sprint 3 nur noch **410 Gone** mit Hinweis auf die neuen
 * Split-Endpoints. Path-Param ist jetzt die ID:
 *
 *   DELETE /api/households/:householdId/budgets/:id
 *   DELETE /api/households/:householdId/income-plans/:id
 *   DELETE /api/households/:householdId/fixed-cost-plans/:id
 *   DELETE /api/households/:householdId/savings-goals/:id
 */
import { createError, defineEventHandler } from 'h3'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  parseUuidParam(event, 'householdId')

  throw createError({
    statusCode: 410,
    statusMessage: 'This endpoint is gone. Use DELETE /api/households/:householdId/{budgets,income-plans,fixed-cost-plans,savings-goals}/:id instead.',
  })
})