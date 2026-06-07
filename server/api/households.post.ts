import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../utils/prisma'
import { requireAuthenticatedUser } from '../utils/household-access'
import { Role } from '@prisma/client'

type CreateHouseholdBody = {
  name?: string
  currency?: string
}

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<CreateHouseholdBody>(event)
  const name = body.name?.trim()
  const currency = body.currency?.trim().toUpperCase() || 'EUR'

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household name is required.',
    })
  }

  const household = await prisma.household.create({
    data: {
      name,
      currency,
      members: {
        create: {
          userId: user.id,
          role: Role.OWNER,
        },
      },
    },
    select: {
      id: true,
      name: true,
      currency: true,
    },
  })

  return { household }
})
