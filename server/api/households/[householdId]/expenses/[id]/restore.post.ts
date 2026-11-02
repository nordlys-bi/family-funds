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
import { assertEnvelopeOpenOn } from '../../../../../utils/envelope-lifecycle'

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
    select: { id: true, deletedAt: true, date: true, envelope: { select: { closedAt: true } } },
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

  // ADR-0005: Eine Wiederherstellung wirkt wie eine neue Buchung — ab dem
  // Stichtag eines geschlossenen Umschlags ist sie deshalb nicht erlaubt
  // (sonst laege wieder eine Ausgabe hinter dem Stichtag auf einem Umschlag,
  // das ab dann nichts mehr fuehrt — sie gehoert zum Nachfolger). Der
  // Startpunkt zaehlt hier bewusst nicht: Die Buchung existierte schon,
  // Altbestand vor dem Start bliebe sonst fuer immer geloescht.
  if (existing.envelope) {
    assertEnvelopeOpenOn(existing.envelope, existing.date)
  }

  await prisma.expenseTransaction.update({
    where: { id: expenseId },
    data: { deletedAt: null },
  })

  return defineApiResponse({ kind: 'expense', restored: true })
})
