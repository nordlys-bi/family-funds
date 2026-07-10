import { Role } from '@prisma/client'
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type AddMemberBody = {
  email?: string
  role?: Role
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdOwner(event, householdId)
  const body = await readBody<AddMemberBody>(event)
  const email = body.email?.trim().toLowerCase()
  const role = body.role === Role.OWNER ? Role.OWNER : Role.MEMBER

  if (!email) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Email is required.',
    })
  }

  const household = await prisma.household.findUnique({
    where: {
      id: householdId,
    },
    select: {
      id: true,
      name: true,
    },
  })

  if (!household) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Household not found.',
    })
  }

  const localUser = await prisma.user.findFirst({
    where: {
      email,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  })

  if (localUser) {
    const existingMembership = await prisma.householdMember.findUnique({
      where: {
        userId_householdId: {
          userId: localUser.id,
          householdId,
        },
      },
    })

    if (existingMembership) {
      return defineApiResponse({
        kind: 'membership',
        message: 'User is already a member of this household.',
        member: existingMembership,
      })
    }

    const member = await prisma.$transaction(async (tx) => {
      const createdMember = await tx.householdMember.create({
        data: {
          userId: localUser.id,
          householdId,
          role,
        },
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

      await tx.householdInvitation.updateMany({
        where: {
          householdId,
          email,
          acceptedAt: null,
        },
        data: {
          acceptedAt: new Date(),
        },
      })

      return createdMember
    })

    return defineApiResponse({
      kind: 'membership',
      member,
    })
  }

  const invitation = await prisma.householdInvitation.upsert({
    where: {
      householdId_email: {
        householdId,
        email,
      },
    },
    create: {
      householdId,
      email,
      role,
      invitedByUserId: user.id,
    },
    update: {
      role,
      invitedByUserId: user.id,
      acceptedAt: null,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
    },
  })

  return defineApiResponse({
    kind: 'invitation',
    invitation,
  })
})
