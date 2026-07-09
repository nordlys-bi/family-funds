/*
 * GET /api/households/:id/invitations
 *
 * Liste der offenen (acceptedAt: null) Einladungen eines Households.
 * Auth: MEMBERSHIP.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { parseUuidParam } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const invitations = await prisma.householdInvitation.findMany({
    where: {
      householdId,
      acceptedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      invitedBy: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
    },
  })

  return { invitations }
})
