/**
 * Checks whether Clerk keys are configured.
 * Returns true when running in Clerk mode, false for Mock mode.
 */
export function isClerkEnabled(): boolean {
  const publishableKey = process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secretKey = process.env.NUXT_CLERK_SECRET_KEY
  return !!(publishableKey && publishableKey.length > 0 && secretKey && secretKey.length > 0)
}
