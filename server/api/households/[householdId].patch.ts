import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireHouseholdOwner } from '../../utils/household-access'

type UpdateHouseholdBody = {
  name?: string
  currency?: string
}

export default defineEventHandler(async (event) => {
  const householdId = event.context.params?.householdId

  if (!householdId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID is required.',
    })
  }

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<UpdateHouseholdBody>(event)
  const name = body.name?.trim()
  const currency = body.currency?.trim().toUpperCase()

  const household = await prisma.household.update({
    where: {
      id: householdId,
    },
    data: {
      ...(name ? { name } : {}),
      ...(currency ? { currency } : {}),
    },
    select: {
      id: true,
      name: true,
      currency: true,
    },
  })

  return { household }
})
