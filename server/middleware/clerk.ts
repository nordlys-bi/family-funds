import { clerkMiddleware } from '@clerk/nuxt/server'

/**
 * Clerk server middleware must run before our app auth middleware so
 * event.context.auth() is available on protected API requests.
 */
export default clerkMiddleware()

