import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer den `?unassigned=1`-Filter in
 * `GET /api/households/:id/transactions` (issue #52).
 *
 * Dashboard-Card "ohne Budgetzuordnung" setzt den Query-Param, der
 * Endpoint erweitert den Expense-Read um `budgetId: null`. Income +
 * Summary-Aggregates bleiben unveraendert.
 *
 * Pattern analog zu transactions.month.test.ts: gleiche Mock-Strategie,
 * Endpoint-Handler ist die Testeinheit.
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

function mockAuth() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
  prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
})

describe('GET /transactions — ?unassigned=1 filter', () => {
  it('adds budgetId: null to the expense findMany where when unassigned=1', async () => {
    await handler(makeEvent({ unassigned: '1', month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeNull()
  })

  it('does not add budgetId filter when unassigned is not "1"', async () => {
    await handler(makeEvent({ month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeUndefined()
  })

  it('does not add budgetId filter for any other unassigned value (e.g. "true")', async () => {
    // Wir wollen strikt "1" akzeptieren, nicht "true" / "yes" / "ja".
    // Das haelt den Query-String kompakt und im Einklang mit
    // includeDeleted=1, month=YYYY-MM etc.
    await handler(makeEvent({ unassigned: 'true', month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeUndefined()
  })

  it('does not affect the income findMany when unassigned=1', async () => {
    // Income hat kein budgetId-Feld in der Schema — der Filter ist
    // semantisch nur auf Expenses anwendbar. Der Income-Read soll
    // nicht ausgehebelt werden, falls die Page unassigned=1 setzt.
    await handler(makeEvent({ unassigned: '1', month: '2026-05' }))
    const call = prismaMocks.incomeTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeUndefined()
  })

  it('combines unassigned filter with month filter', async () => {
    await handler(makeEvent({ unassigned: '1', month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeNull()
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.getMonth()).toBe(4) // Mai
    expect(dateFilter.lt!.getMonth()).toBe(5) // Juni
  })

  it('combines unassigned filter with cursor (before)', async () => {
    await handler(makeEvent({ unassigned: '1', month: '2026-05', before: '2026-05-15' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeNull()
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.lt!.getDate()).toBe(15) // Cursor-Datum, nicht monthEnd
  })

  it('keeps soft-delete filter intact when unassigned=1 is combined with it', async () => {
    // includeDeleted=1 schaltet deletedAt: null aus. Beide Flags sollen
    // unabhängig voneinander funktionieren.
    await handler(makeEvent({ unassigned: '1', includeDeleted: '1', month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.budgetId).toBeNull()
    expect(call?.where?.deletedAt).toBeUndefined()
  })

  it('default read (no unassigned) keeps deletedAt: null', async () => {
    // Regression-Check: ohne unassigned=1 muss der soft-delete filter
    // weiterhin greifen (issue #58 + #65).
    await handler(makeEvent({ month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    expect(call?.where?.deletedAt).toBeNull()
  })
})

describe('GET /transactions — ?unassigned=1 effect on summary', () => {
  it('expenseTotal + unassignedExpenseTotal are equal when unassigned=1', async () => {
    // Mock: alle expenses des Monats sind unassigned, also muss die
    // expenseTotal-Aggregate dasselbe liefern wie unassignedExpenseTotal.
    prismaMocks.expenseTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 30000 } }) // expenseTotal
      .mockResolvedValueOnce({ _sum: { amount: 30000 } }) // unassignedExpenseTotal
    prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50000 } })

    const response = await handler(makeEvent({ unassigned: '1', month: '2026-05' }))
    expect(response.summary.expenseTotal).toBe(30000)
    expect(response.summary.unassignedExpenseTotal).toBe(30000)
    expect(response.summary.incomeTotal).toBe(50000)
  })

  it('incomeTotal aggregate is not affected by unassigned=1', async () => {
    // Mock: unassigned=1 darf den income-Aggregate nicht beruehren.
    prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 75000 } })
    prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })

    await handler(makeEvent({ unassigned: '1', month: '2026-05' }))
    expect(prismaMocks.incomeTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ budgetId: expect.anything() }),
      }),
    )
  })
})
