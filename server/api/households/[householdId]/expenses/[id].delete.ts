/*
 * DELETE /api/households/:householdId/expenses/:id
 *
 * Soft-Delete einer Expense-Transaktion (issue #58).
 *
 * Setzt `deletedAt = now()` statt die Zeile zu loeschen. Vorteile:
 *  - Audit-Trail bleibt erhalten (wer hat wann was geloescht)
 *  - Wiederherstellung via POST /restore moeglich
 *  - DB-Groesse bei privater App irrelevant
 *
 * Variante A (soft-permanent): kein Cron / Auto-Hard-Delete.
 * Der Datensatz bleibt mit `deletedAt != null` fuer immer in der DB.
 *
 * Path-Param ist die ID, kein `kind`-Body mehr (issue #27 Finding A —
 * DELETE mit JSON-Body verstoesst gegen REST-Idempotenz und wird von
 * manchen fetch-Clients bei CORS gestrippt).
 *
 * 404-Verhalten: wir geben 404 zurueck, wenn die Zeile nicht im
 * aktiven Set ist — d. h. entweder nie existiert oder bereits
 * soft-deleted. Das vereinfacht die UI-Logik (idempotente Loesche-
 * Versuche sind eh nicht mehr in der Liste sichtbar).
 *
 * Auth: `requireHouseholdMembership` — Members duerfen loeschen,
 * weil sie auch Transaktionen anlegen duerfen.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const expenseId = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)

  // Nur aktive (nicht soft-deleted) Zeilen koennen soft-deletet werden.
  // 404 fuer "nicht im aktiven Set" — vereinheitlicht Client-Logik.
  const existing = await prisma.expenseTransaction.findFirst({
    where: {
      id: expenseId,
      householdId,
      deletedAt: null,
    },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Expense transaction not found.',
    })
  }

  await prisma.expenseTransaction.update({
    where: { id: expenseId },
    data: { deletedAt: new Date() },
  })

  return defineApiResponse({ kind: 'expense', deleted: true })
})
