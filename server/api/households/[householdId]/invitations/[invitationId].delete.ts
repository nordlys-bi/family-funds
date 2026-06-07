import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'

export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId
  const invitationId = event.context.params?.invitationId

  if (!householdId || !invitationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID and invitation ID are required.',
    })
  }

  await requireHouseholdOwner(event, householdId)

  const invitation = await prisma.householdInvitation.findFirst({
    where: {
      id: invitationId,
      householdId,
      acceptedAt: null,
    },
    select: {
      id: true,
    },
  })

  if (!invitation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Invitation not found.',
    })
  }

  await prisma.householdInvitation.delete({
    where: {
      id: invitationId,
    },
  })

  return { success: true }
})
