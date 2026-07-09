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
import budgetsHandler from '../budgets.get'
import budgetOverviewHandler from '../budget-overview.get'

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

describe('GET /households/:id/budgets', () => {
  it('returns all budgets and their versions, ordered by createdAt desc', async () => {
    mockMembershipSuccess()
    prismaMocks.budget.findMany.mockResolvedValue([])

    await budgetsHandler(makeEvent())

    expect(prismaMocks.budget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: HH_ID },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })
})

describe('GET /households/:id/budget-overview', () => {
  beforeEach(() => {
    mockMembershipSuccess()
    prismaMocks.budget.findMany.mockResolvedValue([])
    prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  })

  it('uses current month when no ?month is given', async () => {
    const response = await budgetOverviewHandler(makeEvent())
    expect(response.budgetOverview).toBeDefined()
    expect(response.householdId).toBe(HH_ID)
    expect(response.monthStart).toBeDefined()
    expect(response.monthEnd).toBeDefined()
  })

  it('accepts ?month=YYYY-MM and bounds the date range to that month', async () => {
    const event = {
      context: { params: { householdId: HH_ID } },
      path: '/api/households/' + HH_ID + '/budget-overview?month=2026-05',
      node: { req: { url: '/api/households/' + HH_ID + '/budget-overview?month=2026-05', headers: {} }, res: {} },
    } as unknown as H3Event

    await budgetOverviewHandler(event)

    expect(prismaMocks.budget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: HH_ID },
      }),
    )
    const expenseCallArgs = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(expenseCallArgs.where.date.gte.getFullYear()).toBe(2026)
    expect(expenseCallArgs.where.date.gte.getMonth()).toBe(4) // 0-basiert: Mai = 4
    expect(expenseCallArgs.where.date.lt.getMonth()).toBe(5) // Juni
  })

  it('rejects malformed month with 400', async () => {
    const event = {
      context: { params: { householdId: HH_ID } },
      path: '/api/households/' + HH_ID + '/budget-overview?month=2026/05',
      node: { req: { url: '/api/households/' + HH_ID + '/budget-overview?month=2026/05', headers: {} }, res: {} },
    } as unknown as H3Event

    await expect(budgetOverviewHandler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('YYYY-MM'),
    })
  })

  it('rejects ?month=invalid values', async () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', 'not-a-month']) {
      const event = {
        context: { params: { householdId: HH_ID } },
        path: '/api/households/' + HH_ID + `/budget-overview?month=${encodeURIComponent(bad)}`,
        node: { req: { url: '/api/households/' + HH_ID + `/budget-overview?month=${encodeURIComponent(bad)}`, headers: {} }, res: {} },
      } as unknown as H3Event
      await expect(budgetOverviewHandler(event)).rejects.toMatchObject({
        statusCode: 400,
      })
    }
  })

  it('returns budget overview structure when budgets exist', async () => {
    prismaMocks.budget.findMany.mockResolvedValue([
      {
        id: 'b-1',
        key: 'budget_food',
        name: 'Lebensmittel',
        versions: [
          {
            id: 'v-1',
            amount: 50000,
            frequency: 'MONTHLY',
            validFrom: new Date('2026-07-01'),
            createdAt: new Date('2026-07-01'),
            updatedAt: new Date('2026-07-01'),
          },
        ],
      },
    ])
    prismaMocks.expenseTransaction.findMany.mockResolvedValue([
      { amount: 10000, date: new Date('2026-07-15'), budgetId: 'b-1' },
    ])

    const response = await budgetOverviewHandler(makeEvent())
    expect(response.budgetOverview).toBeDefined()
    // buildBudgetOverview liefert `{ ..., budgets: BudgetOverviewItem[], unassigned, ... }`
    expect(Array.isArray((response.budgetOverview as any).budgets)).toBe(true)
    expect((response.budgetOverview as any).budgets).toHaveLength(1)
  })
})

describe('Auth-Coverage aller vier Endpoints', () => {
  it.each([
    ['members', membersHandler],
    ['invitations', invitationsHandler],
    ['budgets', budgetsHandler],
    ['budget-overview', budgetOverviewHandler],
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
