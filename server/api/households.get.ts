import { defineEventHandler, createError } from 'h3'
import { prisma } from '../utils/prisma'
import { requireAuthenticatedUser } from '../utils/household-access'

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)

  try {
    const memberships = await prisma.householdMember.findMany({
      where: { userId: user.id },
      include: {
        household: {
          select: {
            id: true,
            name: true,
            currency: true,
            createdAt: true,
          },
        },
      },
    })

    // Map memberships to list of households with role
    // createdAt: mitgegeben fuer First-Time-Empty-States (issue #13).
    // User-seitig entscheidet das Composable, ob ein Haushalt als
    // "gerade angelegt" zaehlt (Schwelle: 7 Tage).
    const households = memberships.map((m) => ({
      id: m.household.id,
      name: m.household.name,
      currency: m.household.currency,
      role: m.role,
      createdAt: m.household.createdAt,
    }))

    return { households }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch households: ' + error.message,
    })
  }
})
