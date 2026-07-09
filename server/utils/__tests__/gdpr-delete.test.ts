import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Role } from '@prisma/client'
import { deleteUserByOidcSubject } from '../gdpr-delete'

/**
 * Tests fuer die GDPR-Loesch-Helper. Wir mocken Prisma via
 * PrismaClient-Interface, nur die Calls die wir brauchen.
 *
 * Helper hat ein blockierendes tx.$transaction → das mocken wir als
 * `async (fn) => fn(tx)`, sodass Transaktions-Calls direkt am tx-Client
 * laufen.
 */

type AnyMock = ReturnType<typeof vi.fn>

function makePrismaStub() {
  const txCounts = {
    householdMember: { count: vi.fn() },
    household: { delete: vi.fn() },
    user: { delete: vi.fn() },
  }

  const tx = {
    householdMember: txCounts.householdMember,
    household: txCounts.household,
    user: txCounts.user,
  }

  const $transaction = vi.fn(async (fn: (tx: any) => any) => fn(tx))

  const outer = {
    user: {
      findUnique: vi.fn(),
    },
    $transaction,
  }

  return { prisma: outer as any, tx, txCounts }
}

const OIDC = 'user_test_oidc_subject_42'
const USER_ID = '9bff8d9f-7d2e-4f1a-b3c8-000000000001'

describe('deleteUserByOidcSubject', () => {
  beforeEach(() => {
    // console.log mocken damit das Audit-JSON keine Test-Ausgabe spammt
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('returns not-found when no user exists with that oidcSubject', async () => {
    const { prisma } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue(null)

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.deleted).toBe(false)
    expect(result.userId).toBeNull()
    expect(result.cascadeDeletedHouseholds).toEqual([])
    expect(result.reason).toBe('not-found')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('deletes user with no memberships directly', async () => {
    const { prisma, tx } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [],
    })

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.deleted).toBe(true)
    expect(result.userId).toBe(USER_ID)
    expect(result.cascadeDeletedHouseholds).toEqual([])
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } })
    expect(tx.household.delete).not.toHaveBeenCalled()
  })

  it('deletes user with MEMBER-only memberships — household lives on', async () => {
    const { prisma, tx, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [
        { id: 'm-1', role: Role.MEMBER, householdId: 'h-1' },
        { id: 'm-2', role: Role.MEMBER, householdId: 'h-2' },
      ],
    })

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.deleted).toBe(true)
    expect(result.cascadeDeletedHouseholds).toEqual([])
    expect(tx.household.delete).not.toHaveBeenCalled()
    expect(txCounts.householdMember.count).not.toHaveBeenCalled() // nur OWNER-Rows werden inspiziert
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } })
  })

  it('deletes user as sole OWNER — household cascade-deletes', async () => {
    const { prisma, tx, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [
        { id: 'm-1', role: Role.OWNER, householdId: 'h-sole' },
        { id: 'm-2', role: Role.MEMBER, householdId: 'h-member' },
      ],
    })
    // Sole-Owner h-sole: count 1
    txCounts.householdMember.count.mockResolvedValueOnce(1)
    // MEMBER auf h-member: nicht OWNER, wird uebersprungen, kein count fuer diese Zeile

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.cascadeDeletedHouseholds).toEqual(['h-sole'])
    expect(tx.household.delete).toHaveBeenCalledWith({ where: { id: 'h-sole' } })
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } })
  })

  it('keeps household when user is one of multiple OWNERs', async () => {
    const { prisma, tx, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [
        { id: 'm-1', role: Role.OWNER, householdId: 'h-multi' },
      ],
    })
    // count 2 (Current user + ein weiterer OWNER) → kein Cascade
    txCounts.householdMember.count.mockResolvedValueOnce(2)

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.cascadeDeletedHouseholds).toEqual([])
    expect(tx.household.delete).not.toHaveBeenCalled()
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } })
  })

  it('handles multiple sole-owner households in one transaction', async () => {
    const { prisma, tx, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [
        { id: 'm-1', role: Role.OWNER, householdId: 'h-sole-1' },
        { id: 'm-2', role: Role.OWNER, householdId: 'h-sole-2' },
        { id: 'm-3', role: Role.MEMBER, householdId: 'h-member' },
      ],
    })
    txCounts.householdMember.count
      .mockResolvedValueOnce(1) // h-sole-1
      .mockResolvedValueOnce(1) // h-sole-2

    const result = await deleteUserByOidcSubject(prisma, OIDC)

    expect(result.cascadeDeletedHouseholds).toEqual(['h-sole-1', 'h-sole-2'])
    expect(tx.household.delete).toHaveBeenCalledTimes(2)
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } })
  })

  it('runs everything in a single transaction', async () => {
    const { prisma, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [
        { id: 'm-1', role: Role.OWNER, householdId: 'h-sole' },
      ],
    })
    txCounts.householdMember.count.mockResolvedValueOnce(1)

    await deleteUserByOidcSubject(prisma, OIDC)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('logs an audit entry on delete', async () => {
    const { prisma, txCounts } = makePrismaStub()
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      memberships: [],
    })

    await deleteUserByOidcSubject(prisma, OIDC)

    expect(console.log).toHaveBeenCalledTimes(1)
    const logEntry = (console.log as AnyMock).mock.calls[0][0]
    const parsed = JSON.parse(logEntry)
    expect(parsed.audit).toBe('gdpr-user-deleted')
    expect(parsed.userId).toBe(USER_ID)
    expect(parsed.oidcSubject).toBe(OIDC)
    expect(parsed.cascadeDeletedHouseholds).toEqual([])
  })
})
