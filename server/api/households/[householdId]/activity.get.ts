/*
 * GET /api/households/:householdId/activity
 *
 * Liefert kompakte Counts pro Household, die der Onboarding-Tour-Auto-
 * Trigger braucht (issue #16): "Hat der Haushalt < 1 Mitglied / Budget /
 * Transaktion?" Wenn ja → Tour auto-starten.
 *
 * Bewusst minimal: nur Counts, keine Volldaten. Reduziert den
 * Payload fuer den Auto-Trigger-Pfad auf ein paar Bytes.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  // Parallel fuer minimaler Latenz (alle Counts gleichzeitig).
  const [memberCount, budgetCount, transactionCount] = await Promise.all([
    prisma.householdMember.count({ where: { householdId } }),
    prisma.budget.count({ where: { householdId } }),
    prisma.expenseTransaction.count({ where: { householdId } }),
  ])

  return defineApiResponse({
    memberCount,
    budgetCount,
    transactionCount,
  })
})