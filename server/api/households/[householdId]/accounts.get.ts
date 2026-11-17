/*
 * GET /api/households/:householdId/accounts
 *
 * Konten mit Saldo von heute (ADR-0006). Leer, solange der Haushalt keine
 * Konten eingefuehrt hat. Dazu das Standardkonto des anfragenden Mitglieds
 * (issue #190), vorausgewaehlt bei Umschlaegen ohne Bindung.
 *
 * Auth: `requireHouseholdMembership` — lesen duerfen alle Mitglieder.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'
import { listAccounts } from '../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const { membership } = await requireHouseholdMembership(event, householdId)

  const [accounts, household] = await Promise.all([
    listAccounts(householdId),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true } }),
  ])
  return { accounts, ledgerSince: household.ledgerSince, defaultAccountId: membership.defaultAccountId }
})
