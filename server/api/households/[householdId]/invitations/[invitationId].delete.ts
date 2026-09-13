import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { isClerkEnabled } from '../../../../utils/auth-mode'
import { revokeClerkInvitation } from '../../../../utils/clerk-invite'

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
      clerkInvitationId: true,
    },
  })

  if (!invitation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Invitation not found.',
    })
  }

  if (isClerkEnabled() && invitation.clerkInvitationId) {
    await revokeClerkInvitation(event, invitation.clerkInvitationId)
  }

  await prisma.householdInvitation.delete({
    where: {
      id: invitationId,
    },
  })

  return defineApiResponse({ success: true })
})
