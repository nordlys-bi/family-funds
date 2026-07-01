import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isClerkEnabled } from '../auth-mode'

describe('isClerkEnabled', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.NUXT_CLERK_SECRET_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns false when both Clerk keys are missing', () => {
    expect(isClerkEnabled()).toBe(false)
  })

  it('returns false when only the publishable key is set', () => {
    process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abc'
    process.env.NUXT_CLERK_SECRET_KEY = ''
    expect(isClerkEnabled()).toBe(false)
  })

  it('returns false when only the secret key is set', () => {
    process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY = ''
    process.env.NUXT_CLERK_SECRET_KEY = 'sk_test_xyz'
    expect(isClerkEnabled()).toBe(false)
  })

  it('returns true when both keys are present and non-empty', () => {
    process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abc'
    process.env.NUXT_CLERK_SECRET_KEY = 'sk_test_xyz'
    expect(isClerkEnabled()).toBe(true)
  })
})