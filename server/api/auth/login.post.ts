import { defineEventHandler, readBody, createError } from 'h3'
import { prisma } from '../../utils/prisma'
import { isClerkEnabled } from '../../utils/auth-mode'
import { issueSessionCookie } from '../../utils/auth-session'

export default defineEventHandler(async (event) => {
  // Im Clerk-Mode ist der Mock-Login-Endpoint nicht erreichbar — wir geben
  // 404 statt 409 zurueck (sicherheits-Standard: "nicht existierend", nicht
  // "existiert, aber nicht erlaubt").
  if (isClerkEnabled()) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    })
  }

  const body = await readBody(event)
  const { userId } = body

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User ID is required',
    })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found',
      })
    }

    issueSessionCookie(event, user.id)

    return {
      success: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        oidcSubject: user.oidcSubject,
      },
    }
  } catch (error: any) {
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Login failed: ' + error.message,
    })
  }
})
