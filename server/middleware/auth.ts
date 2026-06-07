import { defineEventHandler, getCookie } from 'h3'
import { clerkClient, clerkMiddleware } from '@clerk/nuxt/server'
import { prisma } from '../utils/prisma'
import { syncClerkUser } from '../utils/clerk-sync'

export default defineEventHandler(async (event) => {
  // Skip static assets
  if (event.node.req.url?.startsWith('/_nuxt') || event.node.req.url?.startsWith('/__nuxt')) {
    return
  }

  // Skip webhook endpoints (they authenticate via signature, not session)
  if (event.node.req.url?.startsWith('/api/webhooks/')) {
    return
  }

  // Determine auth mode from runtime config
  const config = useRuntimeConfig(event)
  const authMode = config.public.authMode

  if (authMode === 'clerk') {
    try {
      // Fallback: if the Clerk middleware has not run yet for this request,
      // run it here so event.context.auth() is still available.
      if (!event.context.auth) {
        await clerkMiddleware()(event)
      }

      const auth = event.context.auth?.()

      if (auth?.isAuthenticated && auth.userId) {
        const user = await prisma.user.findUnique({
          where: { oidcSubject: auth.userId },
          select: {
            id: true,
            oidcSubject: true,
            email: true,
            displayName: true,
          },
        })

        if (user) {
          event.context.user = user
          return
        }

        // If the webhook has not populated the local user yet, sync it on demand.
        const clerkUser = await clerkClient(event).users.getUser(auth.userId)
        const syncedUser = await syncClerkUser(prisma, clerkUser)
        event.context.user = {
          id: syncedUser.id,
          oidcSubject: syncedUser.oidcSubject,
          email: syncedUser.email,
          displayName: syncedUser.displayName,
        }
      }
    } catch (error) {
      console.error('Clerk auth middleware error:', error)
    }
  } else {
    // --- Mock Mode ---
    // Use session cookie to identify the user (existing M1 behavior)
    const userId = getCookie(event, 'session_user_id')

    if (userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            oidcSubject: true,
            email: true,
            displayName: true,
          },
        })

        if (user) {
          event.context.user = user
        }
      } catch (error) {
        console.error('Error in mock auth middleware:', error)
      }
    }
  }
})
