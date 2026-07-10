/*
 * POST /api/households/:householdId/expenses/:id/restore
 *
 * Stellt eine soft-deletete Expense-Transaktion wieder her (issue #58).
 *
 * Setzt `deletedAt = null`. Idempotent: Aufruf auf eine bereits aktive
 * (nicht soft-deletete) Buchung liefert 200 ohne State-Change. Aufruf
 * auf eine nie existierte oder einem anderen Haushalt zugeordnete
 * Buchung liefert 404.
 *
 * Auth: `requireHouseholdMembership`.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const expenseId = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)

  // Wir laden die Zeile ohne `deletedAt: null`-Filter, weil wir genau
  // die soft-deletete Variante wollen. Wenn sie nie existierte oder
  // nicht im Haushalt ist, ist sie nicht da — 404.
  const existing = await prisma.expenseTransaction.findFirst({
    where: {
      id: expenseId,
      householdId,
    },
    select: { id: true, deletedAt: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Expense transaction not found.',
    })
  }

  // Idempotent: bereits aktiv → 200 ohne Update
  if (existing.deletedAt === null) {
    return defineApiResponse({ kind: 'expense', restored: true, alreadyActive: true })
  }

  await prisma.expenseTransaction.update({
    where: { id: expenseId },
    data: { deletedAt: null },
  })

  return defineApiResponse({ kind: 'expense', restored: true })
})
