/*
 * DEPRECATED (issue #27): DELETE /api/households/:householdId/transactions
 *
 * Liefert ab Sprint 3 nur noch **410 Gone** mit Hinweis auf die neuen
 * Split-Endpoints. Die alten Routes haben DELETE-mit-Body genutzt
 * (REST-Verletzung), die neuen Routes haben die ID im Path:
 *
 *   DELETE /api/households/:householdId/expenses/:id
 *   DELETE /api/households/:householdId/incomes/:id
 *
 * Das alte Frontend wurde in demselben Slice migriert; dieser Endpoint
 * wird nur noch als dokumentierter Tombstone gehalten.
 */
import { createError, defineEventHandler } from 'h3'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  parseUuidParam(event, 'householdId') // validiert Format; Fehler soll vor 410 kommen

  throw createError({
    statusCode: 410,
    statusMessage: 'This endpoint is gone. Use DELETE /api/households/:householdId/expenses/:id or /incomes/:id instead.',
  })
})