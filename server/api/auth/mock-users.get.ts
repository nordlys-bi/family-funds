import { defineEventHandler, createError } from 'h3'
import { prisma } from '../../utils/prisma'
import { isClerkEnabled } from '../../utils/auth-mode'

export default defineEventHandler(async (event) => {
  if (isClerkEnabled()) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Mock users are not available in Clerk mode',
    })
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        displayName: true,
        email: true,
      },
    })
    return { users }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch mock users: ' + error.message,
    })
  }
})
