/*
 * Tests fuer GET /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Issue #39: History-Endpoint fuer Sparziel-Bewegungen. Vorher lieferte der
 * Endpoint `{ executions: [...] }` ohne Envelope; jetzt `defineApiResponse`,
 * plus `?limit` Query-Param mit Validation.
 *
 * Was getestet wird:
 *  - Happy-Path: MEMBER liest History sortiert nach date desc.
 *  - Happy-Path: OWNER liest ebenfalls (Regression-Schutz).
 *  - 403 wenn der User nicht im Haushalt ist.
 *  - 404 wenn der Goal nicht zum Household gehoert (cross-household-Schutz).
 *  - 400 bei ungueltiger UUID.
 *  - 400 bei invalid limit (negativ, 0, zu gross).
 *  - Default-Limit (50) wenn kein `?limit` mitgegeben wird.
 *  - Custom-Limit wird respektiert.
 *  - Stable-Ordering: bei gleichem Datum gewinnt der juengere createdAt.
 *
 * Pattern-Vorlage: server/api/households/[householdId]/savings-goals/[goalId]/
 *                  __tests__/executions.post.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  savingsGoal: { findFirst: vi.fn() },
  savingsGoalExecution: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

// h3 getQuery mocken — wir setzen den Mock per Test in `setQuery`.
const getQueryMock = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('h3', async (importActual) => {
  const actual = await importActual<typeof import('h3')>()
  return {
    ...actual,
    getQuery: getQueryMock,
  }
})

vi.mock('../../../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

function setQuery(query: Record<string, unknown>) {
  getQueryMock.mockReturnValueOnce(query)
}

import handler from '../executions.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'user-member-1'

function makeEvent(householdId = HH_ID, goalId = GOAL_ID): H3Event {
  return {
    context: { params: { householdId, goalId } },
  } as unknown as H3Event
}

function mockMember() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: USER_ID, oidcSubject: 'mock_user_member', email: 'm@h.de', displayName: 'M' },
    membership: { id: 'm-1', userId: USER_ID, householdId: HH_ID, role: 'MEMBER' },
  })
}

function mockOwner() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: USER_ID, oidcSubject: 'mock_user_owner', email: 'o@h.de', displayName: 'O' },
    membership: { id: 'm-1', userId: USER_ID, householdId: HH_ID, role: 'OWNER' },
  })
}

const sampleExecutions = [
  {
    id: 'exec-1',
    savingsGoalId: GOAL_ID,
    amount: 5000,
    date: new Date('2026-07-15T00:00:00'),
    note: 'Urlaubssparen Q3',
    createdAt: new Date('2026-07-15T08:00:00'),
    updatedAt: new Date('2026-07-15T08:00:00'),
  },
  {
    id: 'exec-2',
    savingsGoalId: GOAL_ID,
    amount: -2500,
    date: new Date('2026-07-10T00:00:00'),
    note: null,
    createdAt: new Date('2026-07-10T08:00:00'),
    updatedAt: new Date('2026-07-10T08:00:00'),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  // Default: leerer Query (kein limit-Override).
  getQueryMock.mockReturnValue({})
})

describe('GET /households/:id/savings-goals/:goalId/executions — Issue #39', () => {
  it('laesst MEMBER die History lesen (Standard-Envelope)', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    prismaMocks.savingsGoalExecution.findMany.mockResolvedValue(sampleExecutions)

    const response = await handler(makeEvent())

    expect(response).toEqual({
      data: {
        kind: 'executions',
        items: sampleExecutions,
      },
    })
    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledOnce()
  })

  it('laesst OWNER ebenfalls lesen (Regression-Schutz)', async () => {
    mockOwner()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    prismaMocks.savingsGoalExecution.findMany.mockResolvedValue(sampleExecutions)

    const response = await handler(makeEvent())

    expect(response.data.kind).toBe('executions')
    expect(response.data.items).toHaveLength(2)
  })

  it('sortiert nach date DESC und createdAt DESC (stable order)', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([])

    await handler(makeEvent())

    expect(prismaMocks.savingsGoalExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { savingsGoalId: GOAL_ID },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 50, // default
      }),
    )
  })

  it('respektiert ein explizites limit', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([])
    setQuery({ limit: '20' })

    await handler(makeEvent())

    expect(prismaMocks.savingsGoalExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 }),
    )
  })

  it('respektiert ein explizites offset (Pagination "Mehr laden")', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([])
    setQuery({ limit: '20', offset: '40' })

    await handler(makeEvent())

    expect(prismaMocks.savingsGoalExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 40 }),
    )
  })

  it('lehnt negatives offset mit 400 ab', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setQuery({ offset: '-5' })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('non-negative'),
    })
  })

  it('lehnt nicht-Mitglieder mit 403 ab (Auth bleibt geschuetzt)', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(prismaMocks.savingsGoal.findFirst).not.toHaveBeenCalled()
    expect(prismaMocks.savingsGoalExecution.findMany).not.toHaveBeenCalled()
  })

  it('wirft 404 wenn der Goal nicht zum Household gehoert (cross-household-Schutz)', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue(null)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('Savings goal not found'),
    })
    expect(prismaMocks.savingsGoalExecution.findMany).not.toHaveBeenCalled()
  })

  it('wirft 400 bei ungueltiger UUID', async () => {
    mockMember()
    await expect(
      handler(makeEvent(HH_ID, 'not-a-uuid')),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.savingsGoal.findFirst).not.toHaveBeenCalled()
  })

  it('lehnt limit = 0 mit 400 ab', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setQuery({ limit: '0' })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('positive integer'),
    })
  })

  it('lehnt negatives limit mit 400 ab', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setQuery({ limit: '-5' })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('lehnt limit > 200 mit 400 ab', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setQuery({ limit: '500' })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('at most 200'),
    })
  })
})
