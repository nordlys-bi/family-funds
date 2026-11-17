/*
 * PATCH /api/households/:householdId/account-transfers/:id
 *
 * Aendert Betrag, Datum oder Notiz eines Kontouebertrags (issue #191). Die
 * Konten bleiben fest: fuer ein anderes Konto loeschen und neu buchen, wie
 * bei Umbuchungen zwischen Umschlaegen.
 *
 * Body (alle optional): { amount, date: 'YYYY-MM-DD', note }
 *
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseDateInput, parseMoneyToCents } from '../../../../utils/planning'
import { updateAccountTransfer, type AccountTransferChanges } from '../../../../utils/account-transfers'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  const body = (await readBody<{ amount?: string | number; date?: string; note?: unknown }>(event)) ?? {}
  const changes: AccountTransferChanges = {}
  if (body.amount !== undefined) changes.amount = parseMoneyToCents(body.amount, 'Amount')
  if (body.date !== undefined) changes.date = parseDateInput(body.date, 'Date')
  if (body.note !== undefined) changes.note = typeof body.note === 'string' ? body.note.trim() || null : null

  const item = await updateAccountTransfer(householdId, id, changes)
  return defineApiResponse({ kind: 'accountTransfer', item })
})
