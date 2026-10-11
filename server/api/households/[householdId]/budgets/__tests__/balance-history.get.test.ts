/*
 * GET /api/households/:householdId/budgets/:id/balance-history (ADR-0004)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  budget: { findMany: vi.fn() },
  expenseTransaction: { findMany: vi.fn() },
  savingsGoalExecution: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import handler from '../[id]/balance-history.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const BUDGET_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const PREDECESSOR_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const OTHER_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012'

function makeEvent(query: Record<string, string> = {}, budgetId = BUDGET_ID): H3Event {
  const search = new URLSearchParams(query).toString()
  const pathAndQuery = search ? `/balance-history?${search}` : '/balance-history'
  return {
    context: { params: { householdId: HH_ID, id: budgetId } },
    path: pathAndQuery,
    node: { req: { url: pathAndQuery, headers: {} }, res: {} },
  } as unknown as H3Event
}

const successor = {
  id: BUDGET_ID,
  name: 'Lebensmittel',
  frequency: 'MONTHLY',
  balanceSince: new Date(2026, 9, 1, 12),
  closedAt: null,
  carryoverToBudgetId: null,
  versions: [{ amount: 50000, validFrom: new Date(2026, 9, 1, 12) }],
}
const predecessor = {
  id: PREDECESSOR_ID,
  name: 'Lebensmittel (wöchentlich)',
  frequency: 'WEEKLY',
  balanceSince: new Date(2026, 8, 14, 12),
  closedAt: new Date(2026, 9, 5, 12),
  carryoverToBudgetId: BUDGET_ID,
  versions: [{ amount: 10000, validFrom: new Date(2026, 8, 14, 12) }],
}
const unrelated = {
  id: OTHER_ID,
  name: 'Kinder',
  frequency: 'MONTHLY',
  balanceSince: new Date(2026, 0, 1, 12),
  closedAt: null,
  carryoverToBudgetId: null,
  versions: [{ amount: 100, validFrom: new Date(2026, 0, 1, 12) }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 11, 15))
  authMocks.requireHouseholdMembership.mockResolvedValue({ user: { id: 'u1' }, membership: { role: 'MEMBER' } })
  prismaMocks.budget.findMany.mockResolvedValue([successor, predecessor, unrelated])
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([
    { budgetId: PREDECESSOR_ID, amount: 2500, date: new Date(2026, 8, 20, 12) },
  ])
  prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([
    { sourceBudgetId: BUDGET_ID, amount: 5000, date: new Date(2026, 9, 7, 12) },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /budgets/:id/balance-history', () => {
  it('defaults to the last three months, clamped to the chain start, and includes the predecessor chain', async () => {
    const result = await handler(makeEvent())

    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledWith(expect.anything(), HH_ID)
    // 3 Monate zurueck waere der 11.7., die Kette beginnt aber erst am 14.9.
    expect(result.from).toBe('2026-09-14')
    expect(result.to).toBe('2026-10-11')
    expect(result.chain.map((budget: { id: string }) => budget.id)).toEqual([BUDGET_ID, PREDECESSOR_ID])
    // Nur Buchungen der Kette laden, nicht die des ganzen Haushalts
    const expenseWhere = prismaMocks.expenseTransaction.findMany.mock.calls[0]![0].where
    expect(expenseWhere.budgetId).toEqual({ in: [BUDGET_ID, PREDECESSOR_ID] })
    expect(expenseWhere.deletedAt).toBeNull()

    // 3 Wochen (14.9.–28.9.) à 100 € − 25 € = 275 €, + 500 € Oktober − 50 € Umbuchung
    expect(result.points.at(-1)).toEqual({ date: '2026-10-11', balance: 72500 })
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'carryover', date: '2026-10-05', amount: 27500, fromBudgetName: 'Lebensmittel (wöchentlich)' }),
      expect.objectContaining({ type: 'transfer', date: '2026-10-07', amount: 5000, budgetName: 'Lebensmittel' }),
    ])
  })

  it('accepts an explicit range and clamps `to` to today', async () => {
    const result = await handler(makeEvent({ from: '2026-10-01', to: '2027-01-01' }))
    expect(result.from).toBe('2026-10-01')
    expect(result.to).toBe('2026-10-11')
  })

  it('rejects malformed dates', async () => {
    await expect(handler(makeEvent({ from: '1.10.2026' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects from after to', async () => {
    await expect(handler(makeEvent({ from: '2026-10-10', to: '2026-10-01' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects overly long ranges', async () => {
    await expect(handler(makeEvent({ from: '2020-01-01', to: '2026-10-01' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 for a budget outside the household', async () => {
    await expect(handler(makeEvent({}, 'd4e5f6a7-b8c9-0123-def0-234567890123'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a non-UUID budget id', async () => {
    await expect(handler(makeEvent({}, 'nope'))).rejects.toMatchObject({ statusCode: 400 })
  })
})
