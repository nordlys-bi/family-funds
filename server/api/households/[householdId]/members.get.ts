/*
 * GET /api/households/:id/members
 *
 * Liste der Mitglieder eines Households inkl. User-Detail-Snapshot
 * (id, email, displayName, oidcSubject). Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const members = await prisma.householdMember.findMany({
    where: { householdId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          oidcSubject: true,
        },
      },
    },
  })

  return { members }
})
