/*
 * GET /api/households/:id/budgets
 *
 * Liste der Budgets eines Households inkl. aller Versionen
 * (History-Liste fuer Planning-Pages). Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const budgets = await prisma.budget.findMany({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      key: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: { validFrom: 'desc' },
        select: {
          id: true,
          amount: true,
          frequency: true,
          validFrom: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  return { budgets }
})
