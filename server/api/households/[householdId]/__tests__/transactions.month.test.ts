import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer den Monatsfilter in `GET /api/households/:id/transactions`
 * (issue #9). Pattern: gleiche Mock-Strategie wie die Pagination-Tests —
 * Prisma-Client und Auth-Layer gemockt, der Endpoint-Handler selbst ist
 * die Testeinheit.
 *
 * Wichtige Assertions:
 *  - month-Validierung (YYYY-MM regex, Monats-Bereich 1-12, Jahr 1900-3000)
 *  - Default = aktueller Monat (kein month-Param)
 *  - Filter-Anwendung: monthStart/monthEnd landen im date-{gte,lt}-Where-Clause
 *  - Aggregate beziehen sich auf den gewaehlten Monat
 *  - Response enthaelt monthStart/monthEnd fuer Frontend-URL-Sync
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

describe('GET /transactions — month-Param Validation', () => {
  it('throws 400 when month is not in YYYY-MM format', async () => {
    await expect(handler(makeEvent({ month: '2026/07' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('YYYY-MM'),
    })
  })

  it('throws 400 when month is gibberish', async () => {
    await expect(handler(makeEvent({ month: 'foo' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('throws 400 when month part is 00', async () => {
    await expect(handler(makeEvent({ month: '2026-00' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('between 01 and 12'),
    })
  })

  it('throws 400 when month part is 13', async () => {
    // regex \d{2} wuerde "13" matchen, daher brauchen wir die Range-Pruefung.
    await expect(handler(makeEvent({ month: '2026-13' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('between 01 and 12'),
    })
  })

  it('throws 400 when year is out of range (too old)', async () => {
    await expect(handler(makeEvent({ month: '1899-12' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('1900 and 3000'),
    })
  })

  it('throws 400 when year is out of range (too future)', async () => {
    await expect(handler(makeEvent({ month: '3001-01' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('accepts a valid month', async () => {
    const response = await handler(makeEvent({ month: '2026-05' }))
    expect(response.monthStart).toBeInstanceOf(Date)
    expect(response.monthEnd).toBeInstanceOf(Date)
  })
})

describe('GET /transactions — month filter applies to query', () => {
  it('uses 1st of the requested month as monthStart', async () => {
    await handler(makeEvent({ month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte).toBeInstanceOf(Date)
    expect(dateFilter.gte!.getFullYear()).toBe(2026)
    expect(dateFilter.gte!.getMonth()).toBe(4) // 0-basiert: Mai = 4
    expect(dateFilter.gte!.getDate()).toBe(1)
  })

  it('uses 1st of the next month as monthEnd (exclusive)', async () => {
    await handler(makeEvent({ month: '2026-05' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.lt).toBeInstanceOf(Date)
    expect(dateFilter.lt!.getFullYear()).toBe(2026)
    expect(dateFilter.lt!.getMonth()).toBe(5) // Juni = 5
    expect(dateFilter.lt!.getDate()).toBe(1)
  })

  it('handles year boundary: December rolls into next-year January', async () => {
    await handler(makeEvent({ month: '2026-12' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.getFullYear()).toBe(2026)
    expect(dateFilter.gte!.getMonth()).toBe(11) // Dezember
    expect(dateFilter.lt!.getFullYear()).toBe(2027) // Folgemonat = Januar 2027
    expect(dateFilter.lt!.getMonth()).toBe(0)
  })

  it('applies the same month filter to income transactions', async () => {
    await handler(makeEvent({ month: '2026-03' }))
    const call = prismaMocks.incomeTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.getMonth()).toBe(2) // Maerz = 2
    expect(dateFilter.lt!.getMonth()).toBe(3) // April = 3
  })

  it('applies the same month filter to the income aggregate', async () => {
    await handler(makeEvent({ month: '2026-08' }))
    expect(prismaMocks.incomeTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      }),
    )
    const call = prismaMocks.incomeTransaction.aggregate.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.getMonth()).toBe(7) // August = 7
    expect(dateFilter.lt!.getMonth()).toBe(8) // September = 8
  })

  it('applies the same month filter to the unassigned-expense aggregate', async () => {
    await handler(makeEvent({ month: '2026-08' }))
    const call = prismaMocks.expenseTransaction.aggregate.mock.calls[1][0] // [0]=expense total, [1]=unassigned
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.getMonth()).toBe(7)
    expect(dateFilter.lt!.getMonth()).toBe(8)
  })
})

describe('GET /transactions — default month behavior', () => {
  it('returns monthStart/monthEnd that are a valid month window when no month given', async () => {
    const response = await handler(makeEvent({}))
    // Ohne month-Param nutzt der Endpoint getMonthWindow() — monthStart ist
    // immer der 1. des (laufenden) Monats, monthEnd der 1. des Folgemonats.
    expect(response.monthStart).toBeInstanceOf(Date)
    expect(response.monthEnd).toBeInstanceOf(Date)
    expect(response.monthStart.getDate()).toBe(1)
    // monthEnd = monthStart + 1 Monat (genauer: gleicher Tag-1, Monat+1).
    expect(response.monthEnd.getDate()).toBe(1)
  })

  it('returns the current month when no month param and no other query', async () => {
    const response = await handler(makeEvent({}))
    const now = new Date()
    expect(response.monthStart.getFullYear()).toBe(now.getFullYear())
    expect(response.monthStart.getMonth()).toBe(now.getMonth())
  })
})

describe('GET /transactions — month filter + cursor compatibility', () => {
  it('combines month filter with `before` cursor (cursor narrows lt)', async () => {
    await handler(makeEvent({ month: '2026-05', before: '2026-05-15', limit: '10' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    // gte muss das monthStart sein (1. Mai)
    expect(dateFilter.gte!.getMonth()).toBe(4)
    expect(dateFilter.gte!.getDate()).toBe(1)
    // lt muss das Cursor-Datum sein (15. Mai), nicht monthEnd
    expect(dateFilter.lt!.getMonth()).toBe(4)
    expect(dateFilter.lt!.getDate()).toBe(15)
  })
})

describe('GET /transactions — month filter + summary', () => {
  it('summary uses the requested month aggregates (not a global count)', async () => {
    // Mock liefert spezifische Summen, damit klar ist, dass monthStart/monthEnd
    // die Aggregate bestimmen.
    prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100000 } })
    prismaMocks.expenseTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 40000 } }) // expenseTotal
      .mockResolvedValueOnce({ _sum: { amount: 5000 } }) // unassignedExpenseTotal
    prismaMocks.expenseTransaction.findMany.mockResolvedValue([
      {
        id: 'e-1', amount: 10000, description: 'X', date: new Date('2026-05-10'),
        createdAt: new Date(), updatedAt: new Date(), budgetId: null, budget: null,
        user: { id: 'user-1', displayName: 'Jan', email: 'jan@example.com' },
      },
    ])

    const response = await handler(makeEvent({ month: '2026-05' }))

    expect(response.summary.incomeTotal).toBe(100000)
    expect(response.summary.expenseTotal).toBe(40000)
    expect(response.summary.unassignedExpenseTotal).toBe(5000)
    expect(response.summary.netTotal).toBe(60000) // 100000 - 40000
  })
})
