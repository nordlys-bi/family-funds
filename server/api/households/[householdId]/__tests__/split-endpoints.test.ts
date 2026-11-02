import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer die vier Sub-Endpoints, die das alte fat /current
 * aufspalten:
 *   - GET /api/households/:householdId/members
 *   - GET /api/households/:householdId/invitations
 *   - GET /api/households/:householdId/budgets
 *   - GET /api/households/:householdId/budget-overview
 *
 * Auth-Pattern: alle vier rufen `requireHouseholdMembership` auf;
 * nicht-Members bekommen 403. Membership-Mock wird per vi.fn() injiziert.
 */

const prismaMocks = vi.hoisted(() => ({
  householdMember: { findMany: vi.fn() },
  householdInvitation: { findMany: vi.fn() },
  budget: { findMany: vi.fn() },
  expenseTransaction: { findMany: vi.fn() },
  savingsGoalExecution: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import membersHandler from '../members.get'
import invitationsHandler from '../invitations.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(): H3Event {
  return {
    context: { params: { householdId: HH_ID } },
  } as unknown as H3Event
}

function mockMembershipSuccess() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1', email: 'jan@example.com', displayName: 'Jan' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([])
})

describe('GET /households/:id/members', () => {
  it('returns the members list with auth', async () => {
    mockMembershipSuccess()
    prismaMocks.householdMember.findMany.mockResolvedValue([
      {
        id: 'm-1',
        role: Role.OWNER,
        createdAt: new Date('2026-07-01'),
        user: { id: 'user-1', email: 'jan@example.com', displayName: 'Jan', oidcSubject: 'auth0|1' },
      },
    ])

    const response = await membersHandler(makeEvent())
    expect(response.members).toHaveLength(1)
    expect(prismaMocks.householdMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: HH_ID },
        orderBy: { createdAt: 'asc' },
      }),
    )
  })
})

describe('GET /households/:id/invitations', () => {
  it('only returns open invitations (acceptedAt: null)', async () => {
    mockMembershipSuccess()
    prismaMocks.householdInvitation.findMany.mockResolvedValue([])

    await invitationsHandler(makeEvent())

    expect(prismaMocks.householdInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: HH_ID, acceptedAt: null },
      }),
    )
  })
})

describe('Auth-Coverage der Endpoints', () => {
  it.each([
    ['members', membersHandler],
    ['invitations', invitationsHandler],
  ])('%s requires membership', async (_name, handler) => {
    authMocks.requireHouseholdMembership.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 403,
    })
  })
})
