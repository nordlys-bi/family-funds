/*
 * GET /api/households/:householdId/accounts/introduction?date=YYYY-MM-DD
 *
 * Vorschau der Einfuehrung (ADR-0006): bisheriges "Zu verteilen" am Vortag,
 * Summe der Umschlaege am Vortag und Zahl der Buchungen ohne Konto ab dem
 * Tag. Neuer Startwert = Σ Kontostaende − `envelopesBefore`.
 *
 * Auth: `requireHouseholdOwner` — nur Owner fuehren Konten ein.
 */
import { defineEventHandler, getQuery } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { parseUuidParam } from '../../../../utils/validation'
import { parseDateInput } from '../../../../utils/planning'
import { previewIntroduction } from '../../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdOwner(event, householdId)

  return previewIntroduction(householdId, parseDateInput(getQuery(event).date, 'Date'))
})
