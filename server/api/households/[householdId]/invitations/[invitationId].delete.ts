import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const invitationId = parseUuidParam(event, 'invitationId')

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
