/*
 * Soft-Delete Tests (issue #58)
 *
 * Lesepfad des Soft-Delete-Patterns:
 *  - GET filtert `deletedAt: null` per Default
 *  - GET mit `?includeDeleted=1` liefert auch soft-deletete Items
 *
 * DELETE, PATCH und Restore auf geloeschten Zeilen testet seit issue #181
 * server/utils/__tests__/transactions.test.ts gegen den In-Memory-Adapter.
 *
 * Pattern: gleiche Mock-Strategie wie transactions.month.test.ts.
 * Prisma-Client und Auth-Layer gemockt, der Endpoint-Handler ist die
 * Testeinheit.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

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

// Handler-Imports muessen NACH den vi.mock-Calls stehen, weil Vitest
// die Mocks vor dem Modul-Loading auflöst.
import getHandler from '../transactions.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeGetEvent(query: Record<string, string> = {}): H3Event {
  const search = new URLSearchParams(query).toString()
  const pathAndQuery = search ? `/transactions?${search}` : '/transactions'
  return {
    context: { params: { householdId: HH_ID } },
    method: 'GET',
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

// === GET: Default-Filter deletedAt: null =================================
describe('GET /transactions — soft-delete filter (issue #58)', () => {
  it('applies deletedAt: null to all expense reads and aggregates by default', async () => {
    await getHandler(makeGetEvent({ month: '2026-05' }))

    // findMany-Aufruf (Liste)
    const findManyWhere = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]?.where
    expect(findManyWhere).toMatchObject({ deletedAt: null })

    // Aggregate-Aufrufe (expenseTotal + unassignedExpenseTotal)
    for (const call of prismaMocks.expenseTransaction.aggregate.mock.calls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }
  })

  it('applies deletedAt: null to all income reads and aggregates by default', async () => {
    await getHandler(makeGetEvent({ month: '2026-05' }))

    const findManyWhere = prismaMocks.incomeTransaction.findMany.mock.calls[0][0]?.where
    expect(findManyWhere).toMatchObject({ deletedAt: null })

    for (const call of prismaMocks.incomeTransaction.aggregate.mock.calls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }
  })

  it('omits the deletedAt filter when includeDeleted=1 is set (Power-User-Schalter)', async () => {
    await getHandler(makeGetEvent({ month: '2026-05', includeDeleted: '1' }))

    const findManyWhere = prismaMocks.expenseTransaction.findMany.mock.calls[0][0]?.where
    // Filter darf NICHT deletedAt haben (entweder nicht vorhanden oder undefined)
    expect(findManyWhere.deletedAt).toBeUndefined()
  })
})
