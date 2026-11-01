/*
 * POST /api/households/:householdId/transfers
 *
 * Bucht eine Umbuchung zwischen zwei Umschlaegen oder von/nach
 * "Zu verteilen" (ADR-0005). Kein Limit auf den verfuegbaren Saldo — das UI
 * warnt hoechstens. Umbuchungen tauchen in keinem Einnahmen-/Ausgaben-Report
 * auf.
 *
 * Body: {
 *   fromEnvelopeId: string | null, toEnvelopeId: string | null  (null = "Zu verteilen"),
 *   amount: Betrag > 0, date: 'YYYY-MM-DD', note?: string
 * }
 *
 * Zuteilungen entstehen nur ueber `ensureAllocations`, nie hier.
 *
 * Auth: MEMBERSHIP — Umbuchen ist eine Buchung, keine Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransferSides, parseEnvelopeSide } from '../../../utils/envelope-transfer'

type CreateTransferBody = {
  fromEnvelopeId?: string | null
  toEnvelopeId?: string | null
  amount?: string | number
  date?: string
  note?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const { user } = await requireHouseholdMembership(event, householdId)

  const body = (await readBody<CreateTransferBody>(event)) ?? {}
  const fromEnvelopeId = parseEnvelopeSide(body.fromEnvelopeId)
  const toEnvelopeId = parseEnvelopeSide(body.toEnvelopeId)
  if (fromEnvelopeId === undefined || toEnvelopeId === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'fromEnvelopeId and toEnvelopeId are required (null = "Zu verteilen").' })
  }
  const amount = parseMoneyToCents(body.amount, 'Amount')
  const date = parseDateInput(body.date, 'Date')
  await assertTransferSides(householdId, { fromEnvelopeId, toEnvelopeId }, date)

  const item = await prisma.envelopeTransfer.create({
    data: {
      householdId,
      fromEnvelopeId,
      toEnvelopeId,
      amount,
      date,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      userId: user.id,
    },
  })
  return defineApiResponse({ kind: 'transfer', item })
})
