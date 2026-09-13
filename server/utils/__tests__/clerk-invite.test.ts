import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const createInvitation = vi.fn()
const revokeInvitation = vi.fn()
const clerkClient = vi.fn(() => ({
  invitations: { createInvitation, revokeInvitation },
}))

vi.mock('@clerk/nuxt/server', () => ({
  clerkClient,
}))

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    getRequestURL: vi.fn(() => new URL('https://app.example.com/some/path')),
  }
})

const { sendClerkInvitation, revokeClerkInvitation } = await import('../clerk-invite')

const fakeEvent = {} as H3Event

describe('sendClerkInvitation', () => {
  beforeEach(() => {
    createInvitation.mockReset()
    clerkClient.mockClear()
  })

  it('creates a Clerk invitation with a redirectUrl back to /login', async () => {
    createInvitation.mockResolvedValue({ id: 'inv_123' })

    const id = await sendClerkInvitation(fakeEvent, 'person@example.com')

    expect(id).toBe('inv_123')
    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: 'person@example.com',
      redirectUrl: 'https://app.example.com/login',
    })
  })

  it('returns null when Clerk reports a duplicate pending invitation', async () => {
    createInvitation.mockRejectedValue({ status: 422, errors: [{ code: 'duplicate_record' }] })

    const id = await sendClerkInvitation(fakeEvent, 'person@example.com')

    expect(id).toBeNull()
  })

  it('rethrows unexpected errors instead of swallowing them', async () => {
    createInvitation.mockRejectedValue({ status: 500, message: 'boom' })

    await expect(sendClerkInvitation(fakeEvent, 'person@example.com')).rejects.toBeTruthy()
  })
})

describe('revokeClerkInvitation', () => {
  beforeEach(() => {
    revokeInvitation.mockReset()
  })

  it('revokes the invitation by id', async () => {
    revokeInvitation.mockResolvedValue({})

    await revokeClerkInvitation(fakeEvent, 'inv_123')

    expect(revokeInvitation).toHaveBeenCalledWith('inv_123')
  })

  it('ignores a 404 (invitation already accepted or revoked)', async () => {
    revokeInvitation.mockRejectedValue({ status: 404 })

    await expect(revokeClerkInvitation(fakeEvent, 'inv_123')).resolves.toBeUndefined()
  })
})
