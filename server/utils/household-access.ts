import { createError, type H3Event } from 'h3'
import { prisma } from './prisma'

export async function requireAuthenticatedUser(event: H3Event) {
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized. Please log in.',
    })
  }

  return user
}

export async function requireHouseholdMembership(event: H3Event, householdId: string) {
  const user = await requireAuthenticatedUser(event)

  const membership = await prisma.householdMember.findFirst({
    where: {
      userId: user.id,
      householdId,
    },
    include: {
      household: true,
    },
  })

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })
  }

  return { user, membership }
}

export async function requireHouseholdOwner(event: H3Event, householdId: string) {
  const { user, membership } = await requireHouseholdMembership(event, householdId)

  if (membership.role !== 'OWNER') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only owners can manage this household.',
    })
  }

  return { user, membership }
}
