import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * The production code imports `prisma` from `./prisma`. To make these
 * tests work without standing up a real DB, we mock the `./prisma`
 * module. `vi.hoisted` is required because `vi.mock` is hoisted to the
 * top of the file (before the `findFirst` declaration would normally
 * be evaluated).
 */
const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

vi.mock('../prisma', () => ({
  prisma: {
    householdMember: { findFirst },
  },
}))

// Import after vi.mock so the production code sees the mocked module.
import {
  requireAuthenticatedUser,
  requireHouseholdMembership,
  requireHouseholdOwner,
} from '../household-access'

function makeEvent(user: any | null): H3Event {
  return { context: { user } } as H3Event
}

const sampleUser = {
  id: 'user-1',
  oidcSubject: 'mock_user_jan',
  email: 'jan@example.com',
  displayName: 'Jan',
}

const sampleMembership = (role: Role) => ({
  id: `membership-${role.toLowerCase()}`,
  userId: sampleUser.id,
  householdId: 'household-1',
  role,
  household: {
    id: 'household-1',
    name: 'Gemeinsamer Haushalt',
    currency: 'EUR',
  },
})

beforeEach(() => {
  findFirst.mockReset()
})

describe('requireAuthenticatedUser', () => {
  it('returns the user from event.context.user when set', async () => {
    const result = await requireAuthenticatedUser(makeEvent(sampleUser))
    expect(result).toEqual(sampleUser)
  })

  it('throws 401 when event.context.user is missing', async () => {
    await expect(
      requireAuthenticatedUser(makeEvent(null)),
    ).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})

describe('requireHouseholdMembership', () => {
  it('returns { user, membership } when the user is a member', async () => {
    const membership = sampleMembership(Role.MEMBER)
    findFirst.mockResolvedValue(membership)

    const result = await requireHouseholdMembership(makeEvent(sampleUser), 'household-1')

    expect(result.user).toEqual(sampleUser)
    expect(result.membership).toEqual(membership)
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', householdId: 'household-1' },
    })
  })

  it('throws 401 when the user is not authenticated', async () => {
    await expect(
      requireHouseholdMembership(makeEvent(null), 'household-1'),
    ).rejects.toMatchObject({ statusCode: 401 })

    // No prisma lookup should happen if the user is missing.
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('throws 403 when the user is authenticated but not a member', async () => {
    findFirst.mockResolvedValue(null)
    await expect(
      requireHouseholdMembership(makeEvent(sampleUser), 'household-other'),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: expect.stringContaining('You do not have access'),
    })
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', householdId: 'household-other' },
    })
  })
})

describe('requireHouseholdOwner', () => {
  it('returns { user, membership } when the user is OWNER', async () => {
    const membership = sampleMembership(Role.OWNER)
    findFirst.mockResolvedValue(membership)

    const result = await requireHouseholdOwner(makeEvent(sampleUser), 'household-1')

    expect(result.user).toEqual(sampleUser)
    expect(result.membership.role).toBe(Role.OWNER)
  })

  it('throws 403 when the user is only MEMBER (not OWNER)', async () => {
    findFirst.mockResolvedValue(sampleMembership(Role.MEMBER))
    await expect(
      requireHouseholdOwner(makeEvent(sampleUser), 'household-1'),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: expect.stringContaining('Only owners'),
    })
  })

  it('throws 401 when the user is not authenticated', async () => {
    await expect(
      requireHouseholdOwner(makeEvent(null), 'household-1'),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('throws 403 when the user is authenticated but not a member at all', async () => {
    findFirst.mockResolvedValue(null)
    await expect(
      requireHouseholdOwner(makeEvent(sampleUser), 'household-other'),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})