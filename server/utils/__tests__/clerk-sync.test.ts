import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, type PrismaClient } from '@prisma/client'
import { syncClerkUser } from '../clerk-sync'

/**
 * Builds a minimal mock Prisma client that records the operations we care about.
 * Each method returns a vi.fn() so tests can inspect args and override return values.
 */
function makeMockPrisma(overrides: {
  upsertUser?: ReturnType<typeof vi.fn>
  invitations?: any[]
  existingMembershipCount?: number
} = {}) {
  const userUpsert = overrides.upsertUser ?? vi.fn()
  const userUpsertMock = userUpsert as unknown as ReturnType<typeof vi.fn>

  const findManyInvitations = vi.fn().mockResolvedValue(overrides.invitations ?? [])
  const createMany = vi.fn().mockResolvedValue({ count: overrides.invitations?.length ?? 0 })
  const updateManyInvitations = vi.fn().mockResolvedValue({ count: overrides.invitations?.length ?? 0 })
  const $transaction = vi.fn().mockResolvedValue(undefined)

  const countMemberships = vi.fn().mockResolvedValue(overrides.existingMembershipCount ?? 0)
  const createHousehold = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: 'household-new',
    ...data,
  }))
  const createMembership = vi.fn().mockResolvedValue({ id: 'membership-new' })

  const prisma = {
    user: { upsert: userUpsertMock },
    householdInvitation: {
      findMany: findManyInvitations,
      updateMany: updateManyInvitations,
    },
    householdMember: {
      count: countMemberships,
      create: createMembership,
      createMany,
    },
    household: {
      create: createHousehold,
    },
    $transaction,
  } as unknown as PrismaClient

  return {
    prisma,
    spies: {
      userUpsert: userUpsertMock,
      findManyInvitations,
      createMany,
      updateManyInvitations,
      $transaction,
      countMemberships,
      createHousehold,
      createMembership,
    },
  }
}

const baseClerkUser = {
  id: 'user_clerk_123',
  email_addresses: [{ id: 'email_1', email_address: 'Jan@example.com' }],
  primary_email_address_id: 'email_1',
  first_name: 'Jan',
  last_name: 'Schneider',
}

describe('syncClerkUser — user upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts by Clerk id and lowercases the email', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_clerk_123',
      email: 'jan@example.com',
      displayName: 'Jan Schneider',
    })

    await syncClerkUser(prisma, baseClerkUser)

    expect(spies.userUpsert).toHaveBeenCalledOnce()
    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.where).toEqual({ oidcSubject: 'user_clerk_123' })
    expect(args.create.email).toBe('jan@example.com')
    expect(args.create.displayName).toBe('Jan Schneider')
    expect(args.update.email).toBe('jan@example.com')
    expect(args.update.displayName).toBe('Jan Schneider')
  })

  it('falls back to username-based display name when no first/last name is present', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({} as any)

    await syncClerkUser(prisma, {
      id: 'user_no_name',
      email_addresses: [{ id: 'e1', email_address: 'foo@bar.com' }],
      primary_email_address_id: 'e1',
      username: 'jan_schneider',
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.displayName).toBe('jan_schneider')
  })

  it('accepts camelCase Clerk payload (Clerk SDK sometimes uses this shape)', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({} as any)

    await syncClerkUser(prisma, {
      id: 'user_camel',
      emailAddresses: [{ id: 'e1', emailAddress: 'camel@case.com' }],
      primaryEmailAddressId: 'e1',
      firstName: 'Camel',
      lastName: 'Case',
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.email).toBe('camel@case.com')
    expect(args.create.displayName).toBe('Camel Case')
  })
})

describe('syncClerkUser — pending invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts matching pending invitations and marks them accepted', async () => {
    const pendingInvitations = [
      { id: 'inv_1', householdId: 'hh_shared', role: Role.MEMBER },
      { id: 'inv_2', householdId: 'hh_friends', role: Role.OWNER },
    ]
    const { prisma, spies } = makeMockPrisma({
      invitations: pendingInvitations,
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({
      id: 'local-user-uuid',
      email: 'jan@example.com',
    })

    await syncClerkUser(prisma, baseClerkUser)

    expect(spies.$transaction).toHaveBeenCalledOnce()
    const transactionArgs = spies.$transaction.mock.calls[0]![0] as any[]
    expect(transactionArgs).toHaveLength(2)

    // createMany should receive one entry per invitation, with the user's id.
    const createManyCall = spies.createMany.mock.calls[0]![0]
    expect(createManyCall.data).toEqual([
      { userId: 'local-user-uuid', householdId: 'hh_shared', role: Role.MEMBER },
      { userId: 'local-user-uuid', householdId: 'hh_friends', role: Role.OWNER },
    ])

    // updateMany should mark all pending invitations accepted.
    const updateManyCall = spies.updateManyInvitations.mock.calls[0]![0]
    expect(updateManyCall.where.id.in).toEqual(['inv_1', 'inv_2'])
    expect(updateManyCall.data.acceptedAt).toBeInstanceOf(Date)
  })

  it('skips household creation when invitations are accepted', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [{ id: 'inv_1', householdId: 'hh_x', role: Role.MEMBER }],
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({
      id: 'local-user-uuid',
      email: 'jan@example.com',
    })

    await syncClerkUser(prisma, baseClerkUser)

    expect(spies.createHousehold).not.toHaveBeenCalled()
    expect(spies.createMembership).not.toHaveBeenCalled()
  })

  it('does nothing for invitations when none match', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [],
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({
      id: 'local-user-uuid',
      email: 'jan@example.com',
    })

    await syncClerkUser(prisma, baseClerkUser)

    expect(spies.$transaction).not.toHaveBeenCalled()
  })
})

describe('syncClerkUser — default household', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a default household with display-name based title for a fresh user', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [],
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({
      id: 'local-user-uuid',
      email: 'jan@example.com',
      displayName: 'Jan',
    })

    // Use a single-name fixture so the household title is exactly "Haushalt von Jan".
    const singleNameClerkUser = {
      id: 'user_clerk_123',
      email_addresses: [{ id: 'email_1', email_address: 'Jan@example.com' }],
      primary_email_address_id: 'email_1',
      first_name: 'Jan',
    }

    await syncClerkUser(prisma, singleNameClerkUser)

    expect(spies.createHousehold).toHaveBeenCalledOnce()
    const createArgs = spies.createHousehold.mock.calls[0]![0]
    expect(createArgs.data.name).toBe('Haushalt von Jan')

    expect(spies.createMembership).toHaveBeenCalledOnce()
    const membershipArgs = spies.createMembership.mock.calls[0]![0]
    expect(membershipArgs.data).toMatchObject({
      userId: 'local-user-uuid',
      householdId: 'household-new',
      role: Role.OWNER,
    })
  })

  it('falls back to email local-part for the household name', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [],
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({
      id: 'local-user-uuid',
      email: 'jan@example.com',
      displayName: null,
    })

    await syncClerkUser(prisma, {
      id: 'user_no_display',
      email_addresses: [{ id: 'e1', email_address: 'jan@example.com' }],
      primary_email_address_id: 'e1',
    })

    const createArgs = spies.createHousehold.mock.calls[0]![0]
    expect(createArgs.data.name).toBe('Haushalt von jan')
  })

  it('does NOT create a default household when the user already has one', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [],
      existingMembershipCount: 2,
    })
    spies.userUpsert.mockResolvedValue({ id: 'local-user-uuid' } as any)

    await syncClerkUser(prisma, baseClerkUser)

    expect(spies.createHousehold).not.toHaveBeenCalled()
    expect(spies.createMembership).not.toHaveBeenCalled()
  })

  it('honors createDefaultHousehold: false', async () => {
    const { prisma, spies } = makeMockPrisma({
      invitations: [],
      existingMembershipCount: 0,
    })
    spies.userUpsert.mockResolvedValue({ id: 'local-user-uuid' } as any)

    await syncClerkUser(prisma, baseClerkUser, { createDefaultHousehold: false })

    expect(spies.createHousehold).not.toHaveBeenCalled()
    expect(spies.createMembership).not.toHaveBeenCalled()
  })
})

describe('syncClerkUser — email fallback chain', () => {
  it('falls back to the first email when primary_email_address_id does not match any address', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_clerk_fallback',
      email: 'fallback@example.com',
      displayName: 'Fallback User',
    })

    await syncClerkUser(prisma, {
      id: 'user_clerk_fallback',
      email_addresses: [{ id: 'email_x', email_address: 'Fallback@Example.com' }],
      primary_email_address_id: 'email_nonexistent', // intentionally does not match
      first_name: 'Fallback',
      last_name: 'User',
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.email).toBe('fallback@example.com') // first email, lowercased
    expect(args.update.email).toBe('fallback@example.com')
  })

  it('uses the camelCase emailAddress field when snake_case email_address is missing', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_clerk_camel',
      email: 'camel@example.com',
      displayName: 'Camel User',
    })

    await syncClerkUser(prisma, {
      id: 'user_clerk_camel',
      emailAddresses: [{ id: 'email_y', emailAddress: 'Camel@Example.com' }],
      primaryEmailAddressId: 'email_nonexistent',
      firstName: 'Camel',
      lastName: 'User',
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.email).toBe('camel@example.com')
  })
})

describe('syncClerkUser — default household name fallback', () => {
  it('falls back to "Mein Haushalt" when displayName is null and email has no local part', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_no_name',
      email: '@no-local-part.com', // split('@')[0] === '' → empty localPart
      displayName: null,
    })
    spies.countMemberships.mockResolvedValue(0)

    await syncClerkUser(prisma, {
      id: 'user_no_name',
      email_addresses: [{ id: 'e1', email_address: '@no-local-part.com' }],
      primary_email_address_id: 'e1',
      username: null,
    })

    expect(spies.createHousehold).toHaveBeenCalledWith({
      data: { name: 'Mein Haushalt' },
    })
  })

  it('uses the email local part when displayName is null but the email has one', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_email_only',
      email: 'jan@example.com',
      displayName: null,
    })
    spies.countMemberships.mockResolvedValue(0)

    await syncClerkUser(prisma, {
      id: 'user_email_only',
      email_addresses: [{ id: 'e1', email_address: 'jan@example.com' }],
      primary_email_address_id: 'e1',
      username: null,
    })

    expect(spies.createHousehold).toHaveBeenCalledWith({
      data: { name: 'Haushalt von jan' },
    })
  })
})

describe('syncClerkUser — fully empty email fields fall back to username', () => {
  it('returns the lowercase username when neither email_addresses nor primary_email_address_id is set', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_only_username',
      email: 'only_username',
      displayName: null,
    })

    await syncClerkUser(prisma, {
      id: 'user_only_username',
      username: 'Only_UserName', // mixed case to assert lowercasing
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.email).toBe('only_username')
    expect(args.update.email).toBe('only_username')
  })

  it('returns an empty string when the Clerk user has no email fields AND no username', async () => {
    const { prisma, spies } = makeMockPrisma()
    spies.userUpsert.mockResolvedValue({
      id: 'local-uuid',
      oidcSubject: 'user_nothing',
      email: '',
      displayName: null,
    })

    await syncClerkUser(prisma, {
      id: 'user_nothing',
      // no email_addresses, no emailAddresses, no primary_email_address_id,
      // no primaryEmailAddressId, no username — the most degenerate case
    })

    const args = spies.userUpsert.mock.calls[0]![0]
    expect(args.create.email).toBe('')
    expect(args.update.email).toBe('')
  })
})