import { defineEventHandler } from 'h3'

/**
 * Clerk server middleware. Dynamically imports `@clerk/nuxt/server` only when
 * Clerk mode is active, so we don't touch the package's (currently broken)
 * Node-ESM entry point in mock mode.
 *
 * Background: @clerk/nuxt@2.5.x ships `dist/runtime/server/index.js` with
 * relative imports that lack the `.js` extension (`./clerkClient`). When the
 * Nuxt module isn't loaded (because env keys are empty), Nitro doesn't bundle
 * the package and Node tries to resolve it raw — which then throws
 * "Cannot find module .../clerkClient".
 *
 * Runs before `auth.ts` so `event.context.auth()` is populated for Clerk mode.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  if (config.public.authMode !== 'clerk') return

  const { clerkMiddleware } = await import('@clerk/nuxt/server')
  return clerkMiddleware()(event)
})
