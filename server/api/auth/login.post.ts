import { defineEventHandler, readBody, setCookie, createError } from 'h3'
import { prisma } from '../../utils/prisma'
import { isClerkEnabled } from '../../utils/auth-mode'

export default defineEventHandler(async (event) => {
  if (isClerkEnabled()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Mock login is disabled in Clerk mode',
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

    // Set cookie valid for 7 days
    setCookie(event, 'session_user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

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
