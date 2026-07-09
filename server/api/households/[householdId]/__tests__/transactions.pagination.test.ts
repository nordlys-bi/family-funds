import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer die Pagination von `GET /api/households/:id/transactions`.
 *
 * Strategy:
 *  - Mocke Prisma-Client mit `vi.hoisted` (vor allen Imports aufgeloest)
 *  - Verschiedene Aufrufe simulieren unterschiedlich grosse
 *    Result-Sets via `take`-Argument
 *  - Verifiziert: limit-Validierung, hasMore, nextCursor,
 *    Cursor-Anwendung, Aggregates mit/ohne Cursor
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

// Import nach den Mocks.
import handler from '../transactions.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(query: Record<string, string> = {}): H3Event {
  // h3's getQuery liest event.path (Pfad + Query-String) — wir setzen
  // also gleich event.node.req.url, damit andere Tools (z. B. readRawBody)
  // auch funktionieren wuerden.
  const search = new URLSearchParams(query).toString()
  const pathAndQuery = search ? `/dashboard?${search}` : '/dashboard'
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

/**
 * Hilfs-Factory: erzeugt `count` Expense-Rows absteigend nach Datum.
 * Wenn `take` kleiner als `count` ist, bekommt der Mock nur die ersten
 * `take` Rows zurueck (Prisma-seitig).
 */
function makeExpenseRows(count: number, startDate: Date): Array<{
  id: string; amount: number; description: string; date: Date;
  createdAt: Date; updatedAt: Date; budgetId: string | null;
  budget: { id: string; name: string; key: string } | null;
  user: { id: string; displayName: string; email: string };
}> {
  const rows: ReturnType<typeof makeExpenseRows> = []
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate.getTime() - i * 86400000) // 1 day apart
    rows.push({
      id: `e-${i}`,
      amount: 100 * (i + 1),
      description: `Expense ${i}`,
      date,
      createdAt: date,
      updatedAt: date,
      budgetId: null,
      budget: null,
      user: { id: 'user-1', displayName: 'Jan', email: 'jan@example.com' },
    })
  }
  return rows
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
  // Default: Aggregates liefern null/0 fuer leere Inputs.
  prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  // Default findMany: leeres Result
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
})

describe('GET /transactions — Pagination Validation', () => {
  it('throws 400 when limit is 0', async () => {
    await expect(handler(makeEvent({ limit: '0' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('limit must be an integer between 1 and 500'),
    })
  })

  it('throws 400 when limit is > 500', async () => {
    await expect(handler(makeEvent({ limit: '501' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('throws 400 when limit is non-integer', async () => {
    await expect(handler(makeEvent({ limit: 'abc' }))).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(handler(makeEvent({ limit: '1.5' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('throws 400 when before is not a valid date', async () => {
    await expect(handler(makeEvent({ before: 'not-a-date' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('before must be a valid ISO date'),
    })
  })

  it('accepts valid limit and before', async () => {
    await expect(handler(makeEvent({ limit: '50', before: '2026-07-15' }))).resolves.toMatchObject({
      hasMore: false,
      nextCursor: null,
    })
  })
})

describe('GET /transactions — Pagination Logic', () => {
  it('returns hasMore=false when fewer rows exist than the limit', async () => {
    const allExpenses = makeExpenseRows(3, new Date('2026-07-10'))
    prismaMocks.expenseTransaction.findMany.mockResolvedValue(allExpenses)

    const response = await handler(makeEvent({ limit: '50' }))

    expect(response.hasMore).toBe(false)
    expect(response.nextCursor).toBeNull()
    expect(response.transactions).toHaveLength(3)
  })

  it('returns hasMore=true and nextCursor when limit+1 rows were fetched', async () => {
    // Mock liefert "limit + 1" Rows zurueck — endpoint trimmed zu `limit`.
    const fetched = makeExpenseRows(6, new Date('2026-07-15'))
    prismaMocks.expenseTransaction.findMany.mockResolvedValue(fetched)

    const response = await handler(makeEvent({ limit: '5' }))

    expect(response.hasMore).toBe(true)
    expect(response.nextCursor).not.toBeNull()
    expect(response.transactions).toHaveLength(5)
    // nextCursor ist das Datum des letzten Items der getrimmten Liste.
    expect(response.nextCursor).toBe(fetched[4].date.toISOString())
  })

  it('passes `take: limit + 1` to Prisma for hasMore detection', async () => {
    await handler(makeEvent({ limit: '25' }))
    expect(prismaMocks.expenseTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 26 }),
    )
    expect(prismaMocks.incomeTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 26 }),
    )
  })

  it('passes `cursor`-equivalent `where.date.lt` when before is provided', async () => {
    await handler(makeEvent({ limit: '10', before: '2026-07-15' }))
    expect(prismaMocks.expenseTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('does not apply cursor when before is missing', async () => {
    const callDateFilter: unknown = await (async () => {
      await handler(makeEvent({ limit: '10' }))
      const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
      return call?.where?.date
    })()
    // Wenn kein `before` mitgegeben wurde, soll der `date`-Filter
    // ausschliesslich den Monatsbereich (`gte` + `lt`) enthalten —
    // KEIN zusaetzlicher `lt`-Eintrag (was ein "narrower lt" waere).
    // Wir pruefen daher Anzahl der date-Filter-Keys: bei Month-only
    // genau 2 (gte, lt), bei cursor+month sind es ebenfalls 2, aber
    // der `lt` zeigt auf den Cursor-Datum-Wert (nicht den Month-End).
    expect(callDateFilter).toBeDefined()
    const dateKeys = Object.keys(callDateFilter as Record<string, unknown>)
    // Beide Faelle haben 'gte' + 'lt' — der eine Unterschied ist die Quelle.
    expect(dateKeys).toContain('gte')
    expect(dateKeys).toContain('lt')
    // `lt` sollte das monthEnde sein (Deterministic in getMonthWindow),
    // NICHT gleich einer Cursor-Datum-Vorgabe (es ist kein `before` mitgegeben).
    const ltValue = (callDateFilter as Record<string, Date>).lt
    expect(ltValue).toBeInstanceOf(Date)
    // Monats-lt = 1. des Folgemonats um 00:00 lokal; nur Sanity-Check,
    // dass es kein Cursor-Datum (2026-07-15 o. a.) ist.
    expect(ltValue.getUTCDate()).toBe(1)
  })

  it('uses default limit 200 when no limit query param', async () => {
    await handler(makeEvent({}))
    expect(prismaMocks.expenseTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 201 }),
    )
  })

  it('caps at limit 500 when limit=500', async () => {
    await handler(makeEvent({ limit: '500' }))
    expect(prismaMocks.expenseTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 501 }),
    )
  })

  it('combines expenses and incomes with hasMore from either table', async () => {
    // expenses: limit + 1 (triggers hasMore)
    // incomes: under limit
    const expenses = makeExpenseRows(11, new Date('2026-07-15'))
    prismaMocks.expenseTransaction.findMany.mockResolvedValue(expenses)
    prismaMocks.incomeTransaction.findMany.mockResolvedValue([
      { id: 'i-1', amount: 50000, description: 'Gehalt', date: new Date('2026-07-01'),
        createdAt: new Date(), updatedAt: new Date(),
        user: { id: 'user-1', displayName: 'Jan', email: 'jan@example.com' } },
    ])

    const response = await handler(makeEvent({ limit: '10' }))

    expect(response.hasMore).toBe(true)
    // Trim: 11+1=12 expenses werden zu 10 getrimmt; 1 income;
    // die Top-10 nach date-desc haben expenses[0..9].
    expect(response.transactions).toHaveLength(10)
  })
})
