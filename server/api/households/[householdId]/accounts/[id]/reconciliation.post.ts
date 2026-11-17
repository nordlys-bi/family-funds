/*
 * POST /api/households/:householdId/accounts/:id/reconciliation
 *
 * Gleicht das Konto ab (issue #192): Die Differenz zwischen eingegebenem und
 * berechnetem Stand am Ende des Tages wird als Korrektur gebucht. Sie trifft
 * das Konto und "Zu verteilen", nie einen Umschlag. Ohne Differenz bleibt
 * ein Eintrag "abgeglichen" mit Betrag 0.
 *
 * Body: { date: 'YYYY-MM-DD', statedBalance: Betrag (darf negativ sein), note? }
 *
 * Auth: MEMBERSHIP — Abgleichen ist Buchen, keine Planung.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { parseSignedMoney } from '../../../../../utils/envelope-lifecycle'
import { reconcileAccount } from '../../../../../utils/account-reconciliation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const accountId = parseUuidParam(event, 'id')
  const { user } = await requireHouseholdMembership(event, householdId)

  const body = (await readBody<{ date?: string; statedBalance?: unknown; note?: unknown }>(event)) ?? {}
  const item = await reconcileAccount(householdId, accountId, user.id, {
    date: parseDateInput(body.date, 'Date'),
    statedBalance: parseSignedMoney(body.statedBalance, 'Stated balance'),
    note: typeof body.note === 'string' ? body.note.trim() || null : null,
  })
  return defineApiResponse({ kind: 'accountAdjustment', item })
})
