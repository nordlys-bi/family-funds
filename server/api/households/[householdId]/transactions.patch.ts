import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseDateInput, parseMoneyToCents } from '../../../utils/planning'
import { assertTransactionKind } from '../../../utils/transactions'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'
import { assertBookingEnvelope } from '../../../utils/envelope-transfer'

type TransactionUpdateBody = {
  kind: string
  id: string
  amount?: string | number
  description?: string | null
  date?: string
  // ADR-0005: Umschlag, null = "Zu verteilen". Fuer Ausgaben und Einnahmen.
  envelopeId?: string | null
  // Alter Name bis zur neuen Erfassung (#156), nur fuer Ausgaben.
  budgetId?: string | null
}

/** `undefined` = nicht geaendert, `null` = "Zu verteilen". */
function parseEnvelopeChange(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  return value?.trim() || null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const body = await readBody<TransactionUpdateBody>(event)
  const kind = assertTransactionKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transaction ID is required.',
    })
  }

  const amount = body.amount !== undefined ? parseMoneyToCents(body.amount, 'Amount') : undefined
  const date = body.date ? parseDateInput(body.date, 'Date') : undefined
  const description = body.description === undefined ? undefined : body.description?.trim() || null

  if (kind === 'expense') {
    // Soft-Delete (issue #58): PATCH wirkt nur auf das aktive Set. Soft-
    // deletete Buchungen sind ueber den expliziten POST /restore zu
    // reaktivieren — PATCH ist hier bewusst 404, damit das UI nicht
    // versehentlich eine "geloeschte" Buchung mit anderen Werten
    // ueberschreibt.
    const existing = await prisma.expenseTransaction.findFirst({
      where: {
        id: body.id,
        householdId,
        deletedAt: null,
      },
    })

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Expense transaction not found.',
      })
    }

    const envelopeId = parseEnvelopeChange(body.envelopeId !== undefined ? body.envelopeId : body.budgetId)

    // ADR-0005: Gegen den resultierenden Umschlag und das Datum pruefen —
    // auch ein reines Datums-Update darf eine Ausgabe nicht hinter den
    // Stichtag eines geschlossenen Umschlags schieben.
    await assertBookingEnvelope(householdId, envelopeId === undefined ? existing.envelopeId : envelopeId, date ?? existing.date)

    const item = await prisma.expenseTransaction.update({
      where: { id: body.id },
      data: {
        ...(amount !== undefined ? { amount } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(date ? { date } : {}),
        ...(envelopeId !== undefined ? { envelopeId } : {}),
      },
    })

    return defineApiResponse({ kind, item })
  }

  // Income-Pfad: gleiche Soft-Delete-Semantik.
  const existing = await prisma.incomeTransaction.findFirst({
    where: {
      id: body.id,
      householdId,
      deletedAt: null,
    },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Income transaction not found.',
    })
  }

  const envelopeId = parseEnvelopeChange(body.envelopeId)
  await assertBookingEnvelope(householdId, envelopeId === undefined ? existing.envelopeId : envelopeId, date ?? existing.date)

  const item = await prisma.incomeTransaction.update({
    where: { id: body.id },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(date ? { date } : {}),
      ...(envelopeId !== undefined ? { envelopeId } : {}),
    },
  })

  return defineApiResponse({ kind, item })
})
