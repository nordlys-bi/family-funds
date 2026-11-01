/*
 * PATCH /api/households/:householdId/transfers/:id
 *
 * Gewoehnliche Umbuchung: Seiten, Betrag (> 0), Datum und Notiz aenderbar,
 * von allen Mitgliedern.
 *
 * Gebuchte Zuteilung (`allocationPeriodStart` gesetzt): nur Betrag (>= 0)
 * und Notiz, nur vom OWNER — das ist Planung ("diesen Monat nur 200 €").
 * Auslassen heisst Betrag 0, nicht loeschen: Eine geloeschte Zuteilung
 * wuerde beim naechsten Abruf neu gebucht (ADR-0005, Regel 3).
 */
import { createError, defineEventHandler, readBody } from 'h3'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdMembership, requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseDateInput, parseMoneyToCents } from '../../../../utils/planning'
import { parseMoneyToCentsAllowZero } from '../../../../utils/envelope-lifecycle'
import { assertTransferSides, parseEnvelopeSide } from '../../../../utils/envelope-transfer'

type UpdateTransferBody = {
  fromEnvelopeId?: string | null
  toEnvelopeId?: string | null
  amount?: string | number
  date?: string
  note?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const transferId = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  const existing = await prisma.envelopeTransfer.findFirst({ where: { id: transferId, householdId } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Transfer not found.' })
  const body = (await readBody<UpdateTransferBody>(event)) ?? {}
  const note = body.note === undefined ? undefined : typeof body.note === 'string' ? body.note.trim() || null : null

  if (existing.allocationPeriodStart) {
    await requireHouseholdOwner(event, householdId)
    if (body.fromEnvelopeId !== undefined || body.toEnvelopeId !== undefined || body.date !== undefined) {
      throw createError({ statusCode: 400, statusMessage: 'Only amount and note of an allocation can be changed.' })
    }
    const item = await prisma.envelopeTransfer.update({
      where: { id: transferId },
      data: {
        ...(body.amount !== undefined ? { amount: parseMoneyToCentsAllowZero(body.amount, 'Amount') } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    })
    return defineApiResponse({ kind: 'transfer', item })
  }

  const fromEnvelopeId = parseEnvelopeSide(body.fromEnvelopeId)
  const toEnvelopeId = parseEnvelopeSide(body.toEnvelopeId)
  const sides = {
    fromEnvelopeId: fromEnvelopeId === undefined ? existing.fromEnvelopeId : fromEnvelopeId,
    toEnvelopeId: toEnvelopeId === undefined ? existing.toEnvelopeId : toEnvelopeId,
  }
  const date = body.date === undefined ? existing.date : parseDateInput(body.date, 'Date')
  // Gegen das resultierende Paar und Datum pruefen — auch ein reines
  // Datums-Update darf eine Umbuchung nicht hinter den Stichtag schieben.
  await assertTransferSides(householdId, sides, date)

  const data: Prisma.EnvelopeTransferUncheckedUpdateInput = { ...sides, date }
  if (body.amount !== undefined) data.amount = parseMoneyToCents(body.amount, 'Amount')
  if (note !== undefined) data.note = note
  const item = await prisma.envelopeTransfer.update({ where: { id: transferId }, data })
  return defineApiResponse({ kind: 'transfer', item })
})
