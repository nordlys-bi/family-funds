import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { assertCanRemoveOrDemoteOwner } from '../../../../utils/household-ownership'

export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId
  const membershipId = event.context.params?.membershipId

  if (!householdId || !membershipId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID and membership ID are required.',
    })
  }

  await requireHouseholdOwner(event, householdId)

  const membership = await prisma.householdMember.findFirst({
    where: {
      id: membershipId,
      householdId,
    },
    select: {
      id: true,
      role: true,
    },
  })

  if (!membership) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Membership not found.',
    })
  }

  // Enforce CONTEXT.md: a household must always have at least one OWNER.
  // Throws 400 if deleting this membership would leave the household
  // without any OWNER. No-op for non-OWNER memberships.
  await assertCanRemoveOrDemoteOwner(prisma, householdId, membershipId)

  await prisma.householdMember.delete({
    where: {
      id: membershipId,
    },
  })

  return { success: true }
})
