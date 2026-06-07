import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'

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

  if (membership.role === 'OWNER') {
    const ownerCount = await prisma.householdMember.count({
      where: {
        householdId,
        role: 'OWNER',
      },
    })

    if (ownerCount <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You cannot remove the last owner from a household.',
      })
    }
  }

  await prisma.householdMember.delete({
    where: {
      id: membershipId,
    },
  })

  return { success: true }
})
