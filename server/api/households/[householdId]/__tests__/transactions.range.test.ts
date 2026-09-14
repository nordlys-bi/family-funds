import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

/**
 * Tests fuer den expliziten `?from[&to]`-Zeitraumfilter in
 * `GET /api/households/:id/transactions`. Ergaenzt den Monatsfilter
 * (transactions.month.test.ts) fuer Budget-Perioden, die nicht auf
 * Kalendermonate passen (WEEKLY/QUARTERLY/YEARLY/ONCE — Klick auf eine
 * Dashboard-Budget-Karte verlinkt hierher mit exaktem periodStart/periodEnd).
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

describe('GET /transactions — from/to Validation', () => {
  it('throws 400 when from is not a valid date', async () => {
    await expect(handler(makeEvent({ from: 'not-a-date' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('from'),
    })
  })

  it('throws 400 when to is not a valid date', async () => {
    await expect(handler(makeEvent({ from: '2026-09-14T12:00:00.000Z', to: 'nope' }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('to'),
    })
  })
})

describe('GET /transactions — from/to takes priority over month', () => {
  it('uses the exact from/to window instead of a calendar month', async () => {
    await handler(makeEvent({
      from: '2026-09-14T12:00:00.000Z',
      to: '2026-09-21T12:00:00.000Z',
      month: '2026-01', // sollte ignoriert werden, sobald from gesetzt ist
    }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.toISOString()).toBe('2026-09-14T12:00:00.000Z')
    expect(dateFilter.lt!.toISOString()).toBe('2026-09-21T12:00:00.000Z')
  })

  it('applies the same range to income transactions and to the aggregates', async () => {
    await handler(makeEvent({ from: '2026-09-14T12:00:00.000Z', to: '2026-09-21T12:00:00.000Z' }))
    const incomeCall = prismaMocks.incomeTransaction.findMany.mock.calls[0][0]
    const incomeFilter = incomeCall?.where?.date as { gte?: Date; lt?: Date }
    expect(incomeFilter.gte!.toISOString()).toBe('2026-09-14T12:00:00.000Z')
    expect(incomeFilter.lt!.toISOString()).toBe('2026-09-21T12:00:00.000Z')

    const aggCall = prismaMocks.expenseTransaction.aggregate.mock.calls[0][0]
    const aggFilter = aggCall?.where?.date as { gte?: Date; lt?: Date }
    expect(aggFilter.gte!.toISOString()).toBe('2026-09-14T12:00:00.000Z')
    expect(aggFilter.lt!.toISOString()).toBe('2026-09-21T12:00:00.000Z')
  })

  it('leaves the upper bound open when to is omitted (ONCE-Budget ohne Nachfolger)', async () => {
    await handler(makeEvent({ from: '2026-09-14T12:00:00.000Z' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.gte!.toISOString()).toBe('2026-09-14T12:00:00.000Z')
    expect(dateFilter.lt).toBeUndefined()
  })

  it('a cursor (?before) still wins over an open-ended to', async () => {
    await handler(makeEvent({ from: '2026-09-14T12:00:00.000Z', before: '2026-09-18T00:00:00.000Z' }))
    const call = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]
    const dateFilter = call?.where?.date as { gte?: Date; lt?: Date }
    expect(dateFilter.lt!.toISOString()).toBe('2026-09-18T00:00:00.000Z')
  })
})
