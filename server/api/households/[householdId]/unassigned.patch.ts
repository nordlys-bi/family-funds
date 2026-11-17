/*
 * PATCH /api/households/:householdId/unassigned
 *
 * Startpunkt und Anfangsbestand von "Zu verteilen" (ADR-0005).
 *
 * Body (beide optional): {
 *   ledgerSince: 'YYYY-MM-DD',
 *   openingBalance: Betrag (darf 0 oder negativ sein) — das freie Geld zum
 *     Startpunkt, zusaetzlich zu dem, was dann schon in Umschlaegen steckt
 * }
 *
 * Auth: `requireHouseholdOwner` — Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { parseDateInput } from '../../../utils/planning'
import { parseSignedMoney } from '../../../utils/envelope-lifecycle'
import { setLedgerStart } from '../../../utils/envelope-planning'

type UpdateUnassignedBody = {
  ledgerSince?: string
  openingBalance?: string | number
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<UpdateUnassignedBody>(event)) ?? {}
  if (body.ledgerSince === undefined && body.openingBalance === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update.' })
  }
  const item = await setLedgerStart(householdId, {
    ...(body.ledgerSince !== undefined ? { ledgerSince: parseDateInput(body.ledgerSince, 'ledgerSince') } : {}),
    ...(body.openingBalance !== undefined ? { openingBalance: parseSignedMoney(body.openingBalance, 'Opening balance') } : {}),
  })
  return defineApiResponse({ kind: 'unassigned', item })
})
