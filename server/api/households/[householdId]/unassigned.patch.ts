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
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { parseDateInput } from '../../../utils/planning'
import { parseMoneyToCentsAllowZero } from '../../../utils/envelope-lifecycle'

type UpdateUnassignedBody = {
  ledgerSince?: string
  openingBalance?: string | number
}

function parseSignedMoney(value: unknown): number {
  if (typeof value === 'number') return value < 0 ? -parseMoneyToCentsAllowZero(-value, 'Opening balance') : parseMoneyToCentsAllowZero(value, 'Opening balance')
  if (typeof value === 'string' && value.trim().startsWith('-')) return -parseMoneyToCentsAllowZero(value.trim().slice(1), 'Opening balance')
  return parseMoneyToCentsAllowZero(value, 'Opening balance')
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<UpdateUnassignedBody>(event)) ?? {}
  if (body.ledgerSince === undefined && body.openingBalance === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update.' })
  }
  const item = await prisma.household.update({
    where: { id: householdId },
    data: {
      ...(body.ledgerSince !== undefined ? { ledgerSince: parseDateInput(body.ledgerSince, 'ledgerSince') } : {}),
      ...(body.openingBalance !== undefined ? { openingBalance: parseSignedMoney(body.openingBalance) } : {}),
    },
    select: { ledgerSince: true, openingBalance: true },
  })
  return defineApiResponse({ kind: 'unassigned', item })
})
