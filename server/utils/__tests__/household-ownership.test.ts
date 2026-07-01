import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role, type PrismaClient } from '@prisma/client'
import { assertCanRemoveOrDemoteOwner } from '../household-ownership'

/**
 * Mock Prisma: `assertCanRemoveOrDemoteOwner` calls
 * `prisma.householdMember.findUnique` then `prisma.householdMember.count`.
 * Each test overrides the resolved values to drive the code paths.
 */
function makeMockPrisma(overrides: {
  membership?: { role: Role; householdId: string } | null
  ownerCount?: number
} = {}) {
  const findUnique = vi.fn().mockResolvedValue(overrides.membership ?? null)
  const count = vi.fn().mockResolvedValue(overrides.ownerCount ?? 0)
  const prisma = {
    householdMember: { findUnique, count },
  } as unknown as PrismaClient
  return { prisma, spies: { findUnique, count } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertCanRemoveOrDemoteOwner', () => {
  it('returns silently when the membership does not exist', async () => {
    const { prisma, spies } = makeMockPrisma({ membership: null })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-missing'),
    ).resolves.toBeUndefined()

    // No owner count query should happen if the membership is unknown.
    expect(spies.count).not.toHaveBeenCalled()
  })

  it('returns silently when the membership belongs to a different household', async () => {
    const { prisma, spies } = makeMockPrisma({
      membership: { role: Role.OWNER, householdId: 'household-OTHER' },
    })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-1'),
    ).resolves.toBeUndefined()

    expect(spies.count).not.toHaveBeenCalled()
  })

  it('returns silently when the membership is MEMBER (constraint only applies to OWNER)', async () => {
    const { prisma, spies } = makeMockPrisma({
      membership: { role: Role.MEMBER, householdId: 'household-1' },
    })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-1'),
    ).resolves.toBeUndefined()

    expect(spies.count).not.toHaveBeenCalled()
  })

  it('returns silently when the household has multiple OWNERs', async () => {
    const { prisma, spies } = makeMockPrisma({
      membership: { role: Role.OWNER, householdId: 'household-1' },
      ownerCount: 2,
    })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-1'),
    ).resolves.toBeUndefined()

    expect(spies.count).toHaveBeenCalledWith({
      where: { householdId: 'household-1', role: Role.OWNER },
    })
  })

  it('throws 400 when the household has only one OWNER and that OWNER is the target', async () => {
    const { prisma } = makeMockPrisma({
      membership: { role: Role.OWNER, householdId: 'household-1' },
      ownerCount: 1,
    })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-1'),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('at least one owner'),
    })
  })

  it('treats ownerCount of 0 the same as 1 (defensive — household is already in a broken state)', async () => {
    // If the DB somehow has zero OWNERs, we still want to refuse
    // another removal so the invariant check stays meaningful.
    const { prisma } = makeMockPrisma({
      membership: { role: Role.OWNER, householdId: 'household-1' },
      ownerCount: 0,
    })

    await expect(
      assertCanRemoveOrDemoteOwner(prisma, 'household-1', 'membership-1'),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})