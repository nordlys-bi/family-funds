import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer die Filter-Konsistenz von `GET /api/households/:id/transactions`
 * (issue #134): Person-Filter (`?userId=`), Budget-Filter (`?budgetId=`) und
 * `?unassigned=1` muessen NICHT nur die Liste, sondern auch die Summary-
 * Aggregates einschraenken — sonst zeigt die Badge auf der Ausgaben-/
 * Einnahmen-Seite die Gesamtsumme des Zeitraums statt der gefilterten Liste.
 *
 * Prisma ist gemockt; geprueft wird das `where` der Aggregate-/findMany-Calls.
 * Reihenfolge der Expense-Aggregates im Handler: [0] expenseTotal,
 * [1] unassignedExpenseTotal (entfaellt bei aktivem Budget-Filter).
 */

const prismaMocks = vi.hoisted(() => ({
  expenseTransaction: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
  incomeTransaction: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import handler from '../transactions.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const USER_ID = '4a1c2d3e-5f60-4718-9a2b-3c4d5e6f7a8b'
const BUDGET_ID = '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b'

function makeEvent(query: Record<string, string> = {}): H3Event {
  const search = new URLSearchParams(query).toString()
  const pathAndQuery = search ? `/transactions?${search}` : '/transactions'
  return {
    context: { params: { householdId: HH_ID } },
    path: pathAndQuery,
    node: {
      req: { url: pathAndQuery, headers: {} },
      res: {},
    },
  } as unknown as H3Event
}

const expenseFindWhere = () => prismaMocks.expenseTransaction.findMany.mock.calls[0]![0].where
const incomeFindWhere = () => prismaMocks.incomeTransaction.findMany.mock.calls[0]![0].where
const incomeAggregateWhere = () => prismaMocks.incomeTransaction.aggregate.mock.calls[0]![0].where
const expenseTotalWhere = () => prismaMocks.expenseTransaction.aggregate.mock.calls[0]![0].where
const unassignedTotalWhere = () => prismaMocks.expenseTransaction.aggregate.mock.calls[1]![0].where

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
  prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
})

describe('GET /transactions — ?userId= (Person-Filter)', () => {
  it('applies userId to the expense list and every aggregate', async () => {
    await handler(makeEvent({ month: '2026-05', userId: USER_ID }))

    expect(expenseFindWhere().userId).toBe(USER_ID)
    expect(incomeFindWhere().userId).toBe(USER_ID)
    expect(expenseTotalWhere().userId).toBe(USER_ID)
    expect(incomeAggregateWhere().userId).toBe(USER_ID)
    // Der "Ohne Budget"-Chip soll zur Person-Filterung passen.
    expect(unassignedTotalWhere().userId).toBe(USER_ID)
    expect(unassignedTotalWhere().budgetId).toBeNull()
  })

  it('does not add a userId condition when the param is absent or empty', async () => {
    await handler(makeEvent({ month: '2026-05', userId: '' }))

    expect(expenseFindWhere()).not.toHaveProperty('userId')
    expect(incomeFindWhere()).not.toHaveProperty('userId')
    expect(expenseTotalWhere()).not.toHaveProperty('userId')
    expect(incomeAggregateWhere()).not.toHaveProperty('userId')
    expect(unassignedTotalWhere()).not.toHaveProperty('userId')
  })

  it('rejects a userId that is not a UUID with 400', async () => {
    await expect(handler(makeEvent({ month: '2026-05', userId: 'not-a-uuid' }))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(prismaMocks.expenseTransaction.findMany).not.toHaveBeenCalled()
  })

  it('keeps the soft-delete filter alongside userId in the aggregates', async () => {
    await handler(makeEvent({ month: '2026-05', userId: USER_ID }))

    expect(expenseTotalWhere().deletedAt).toBeNull()
    expect(incomeAggregateWhere().deletedAt).toBeNull()
  })

  it('returns the aggregate sums as summary (expenseTotal/incomeTotal/netTotal)', async () => {
    prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50000 } })
    prismaMocks.expenseTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 12000 } })
      .mockResolvedValueOnce({ _sum: { amount: 3000 } })

    const response = await handler(makeEvent({ month: '2026-05', userId: USER_ID }))

    expect(response.summary).toMatchObject({
      incomeTotal: 50000,
      expenseTotal: 12000,
      netTotal: 38000,
      unassignedExpenseTotal: 3000,
    })
  })
})

describe('GET /transactions — ?budgetId= (Budget-Filter)', () => {
  it('applies budgetId to the expense list and the expenseTotal aggregate', async () => {
    await handler(makeEvent({ month: '2026-05', budgetId: BUDGET_ID }))

    expect(expenseFindWhere().budgetId).toBe(BUDGET_ID)
    expect(expenseTotalWhere().budgetId).toBe(BUDGET_ID)
  })

  it('does not touch income (kein Budget-Bezug)', async () => {
    await handler(makeEvent({ month: '2026-05', budgetId: BUDGET_ID }))

    expect(incomeFindWhere()).not.toHaveProperty('budgetId')
    expect(incomeAggregateWhere()).not.toHaveProperty('budgetId')
  })

  it('reports unassignedExpenseTotal as 0 without querying it', async () => {
    const response = await handler(makeEvent({ month: '2026-05', budgetId: BUDGET_ID }))

    // Nur der expenseTotal-Aggregate laeuft — kein Ausgabe kann zugleich
    // dieses Budget haben und "ohne Budget" sein.
    expect(prismaMocks.expenseTransaction.aggregate).toHaveBeenCalledTimes(1)
    expect(response.summary.unassignedExpenseTotal).toBe(0)
  })

  it('combines with userId (AND) in list and aggregate', async () => {
    await handler(makeEvent({ month: '2026-05', budgetId: BUDGET_ID, userId: USER_ID }))

    expect(expenseFindWhere()).toMatchObject({ budgetId: BUDGET_ID, userId: USER_ID })
    expect(expenseTotalWhere()).toMatchObject({ budgetId: BUDGET_ID, userId: USER_ID })
  })

  it('works with an explicit from/to range (Dashboard-Budget-Karte)', async () => {
    await handler(
      makeEvent({
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        budgetId: BUDGET_ID,
      }),
    )

    const totalWhere = expenseTotalWhere()
    expect(totalWhere.budgetId).toBe(BUDGET_ID)
    expect(totalWhere.date).toEqual({
      gte: new Date('2026-05-01T00:00:00.000Z'),
      lt: new Date('2026-06-01T00:00:00.000Z'),
    })
  })

  it('rejects a budgetId that is not a UUID with 400', async () => {
    await expect(handler(makeEvent({ month: '2026-05', budgetId: '123' }))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(prismaMocks.expenseTransaction.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /transactions — ?unassigned=1 im Aggregate (issue #134)', () => {
  it('applies budgetId: null to the expenseTotal aggregate, not only to the list', async () => {
    await handler(makeEvent({ month: '2026-05', unassigned: '1' }))

    expect(expenseFindWhere().budgetId).toBeNull()
    expect(expenseTotalWhere().budgetId).toBeNull()
  })

  it('still reports unassignedExpenseTotal via its own aggregate', async () => {
    await handler(makeEvent({ month: '2026-05', unassigned: '1' }))

    expect(prismaMocks.expenseTransaction.aggregate).toHaveBeenCalledTimes(2)
    expect(unassignedTotalWhere().budgetId).toBeNull()
  })

  it('leaves the income aggregate alone', async () => {
    await handler(makeEvent({ month: '2026-05', unassigned: '1' }))

    expect(incomeAggregateWhere()).not.toHaveProperty('budgetId')
  })

  it('does not filter the aggregate for other unassigned values (strikt "1")', async () => {
    await handler(makeEvent({ month: '2026-05', unassigned: 'true' }))

    expect(expenseTotalWhere()).not.toHaveProperty('budgetId')
  })

  it('yields the empty set when combined with a budget filter (Widerspruch)', async () => {
    await handler(makeEvent({ month: '2026-05', unassigned: '1', budgetId: BUDGET_ID }))

    // `budgetId IN ()` matcht nichts — Liste und Summe sind konsistent leer.
    expect(expenseFindWhere().budgetId).toEqual({ in: [] })
    expect(expenseTotalWhere().budgetId).toEqual({ in: [] })
  })
})

describe('GET /transactions — ohne Filter (Regression)', () => {
  it('keeps the aggregates unfiltered by user/budget and unassignedExpenseTotal budgetId: null', async () => {
    await handler(makeEvent({ month: '2026-05' }))

    expect(expenseTotalWhere()).not.toHaveProperty('userId')
    expect(expenseTotalWhere()).not.toHaveProperty('budgetId')
    expect(incomeAggregateWhere()).not.toHaveProperty('userId')
    expect(unassignedTotalWhere().budgetId).toBeNull()
  })
})
