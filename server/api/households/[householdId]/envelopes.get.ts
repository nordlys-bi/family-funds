/*
 * GET /api/households/:householdId/envelopes
 *
 * Alle Umschlaege des Haushalts (auch geschlossene) mit Saldo, laufender
 * Periode, Bewertung nach Saldo, Vormerkung und Saldo-Trend, dazu
 * "Zu verteilen" (ADR-0005). Bucht vorher faellige Zuteilungen.
 *
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'
import { loadEnvelopeOverview } from '../../../utils/envelope-overview'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  await requireHouseholdMembership(event, householdId)
  return loadEnvelopeOverview(householdId)
})
