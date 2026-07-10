/*
 * Soft-Delete Tests (issue #58)
 *
 * Testet das Soft-Delete-Pattern auf Transaktionen:
 *  - DELETE setzt `deletedAt` (kein Hard-Delete)
 *  - GET filtert `deletedAt: null` per Default
 *  - GET mit `?includeDeleted=1` liefert auch soft-deletete Items
 *  - PATCH weigert sich auf soft-deletete Items (404)
 *  - POST /restore hebt `deletedAt` auf null auf
 *  - POST /restore auf bereits aktive Items ist idempotent (200 ohne Update)
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
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  incomeTransaction: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
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
import patchHandler from '../transactions.patch'
import deleteExpenseHandler from '../expenses/[id].delete'
import deleteIncomeHandler from '../incomes/[id].delete'
import restoreExpenseHandler from '../expenses/[id]/restore.post'
import restoreIncomeHandler from '../incomes/[id]/restore.post'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const EXPENSE_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const INCOME_ID = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e'

function makeEvent(method: string, params: Record<string, string> = {}): H3Event {
  return {
    context: { params },
    method,
    node: {
      req: { url: '', headers: {}, method },
      res: {},
    },
  } as unknown as H3Event
}

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

// === DELETE: Soft-Delete auf Expenses =====================================
describe('DELETE /expenses/:id — soft-delete (issue #58)', () => {
  it('updates the row to set deletedAt instead of removing it', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({ id: EXPENSE_ID })
    prismaMocks.expenseTransaction.update.mockResolvedValue({ id: EXPENSE_ID, deletedAt: new Date() })

    const result = await deleteExpenseHandler(
      makeEvent('DELETE', { householdId: HH_ID, id: EXPENSE_ID }),
    )

    // Envelope-Pattern (issue #27): { data: { kind, deleted: true } }
    expect(result).toEqual({ data: { kind: 'expense', deleted: true } })
    expect(prismaMocks.expenseTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXPENSE_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('looks up the row with deletedAt: null filter (only active rows can be soft-deleted)', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue(null)

    await expect(
      deleteExpenseHandler(makeEvent('DELETE', { householdId: HH_ID, id: EXPENSE_ID })),
    ).rejects.toMatchObject({ statusCode: 404 })

    const whereArg = prismaMocks.expenseTransaction.findFirst.mock.calls[0][0]?.where
    expect(whereArg).toMatchObject({
      id: EXPENSE_ID,
      householdId: HH_ID,
      deletedAt: null,
    })
  })
})

// === DELETE: Soft-Delete auf Incomes ======================================
describe('DELETE /incomes/:id — soft-delete (issue #58)', () => {
  it('updates the row to set deletedAt instead of removing it', async () => {
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue({ id: INCOME_ID })
    prismaMocks.incomeTransaction.update.mockResolvedValue({ id: INCOME_ID, deletedAt: new Date() })

    const result = await deleteIncomeHandler(
      makeEvent('DELETE', { householdId: HH_ID, id: INCOME_ID }),
    )

    expect(prismaMocks.incomeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INCOME_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
    expect(result).toEqual({ data: { kind: 'income', deleted: true } })
  })

  it('returns 404 if the row is not active (already soft-deleted)', async () => {
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue(null)

    await expect(
      deleteIncomeHandler(makeEvent('DELETE', { householdId: HH_ID, id: INCOME_ID })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
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

// === PATCH: 404 auf soft-deletete Items ==================================
describe('PATCH /transactions — refuses to edit soft-deleted rows (issue #58)', () => {
  it('returns 404 when patching an expense with deletedAt set', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue(null)

    // h3's readBody liest den Body aus event.node.req. Wir setzen ihn
    // direkt als Object — h3 erkennt bereits geparste Bodies und gibt
    // sie ohne Re-Parsing zurueck. Damit umgehen wir den h3-ESM-Freeze,
    // der ein spyOn auf readBody nicht zulaesst.
    const event = {
      context: { params: { householdId: HH_ID } },
      method: 'PATCH',
      node: {
        req: {
          url: '',
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
          body: { kind: 'expense', id: EXPENSE_ID },
        },
        res: {},
      },
    } as unknown as H3Event

    await expect(patchHandler(event)).rejects.toMatchObject({ statusCode: 404 })

    // findFirst muss deletedAt: null im where haben
    const whereArg = prismaMocks.expenseTransaction.findFirst.mock.calls[0][0]?.where
    expect(whereArg).toMatchObject({ deletedAt: null })
  })
})

// === POST /restore: Re-Aktivierung ========================================
describe('POST /expenses/:id/restore — restore soft-deleted row (issue #58)', () => {
  it('sets deletedAt = null on a soft-deleted row', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({
      id: EXPENSE_ID,
      deletedAt: new Date(),
    })
    prismaMocks.expenseTransaction.update.mockResolvedValue({ id: EXPENSE_ID, deletedAt: null })

    const result = await restoreExpenseHandler(
      makeEvent('POST', { householdId: HH_ID, id: EXPENSE_ID }),
    )

    expect(prismaMocks.expenseTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXPENSE_ID },
        data: { deletedAt: null },
      }),
    )
    expect(result).toEqual({ data: { kind: 'expense', restored: true } })
  })

  it('is idempotent: restore on an already-active row returns 200 without update', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({
      id: EXPENSE_ID,
      deletedAt: null,
    })

    const result = await restoreExpenseHandler(
      makeEvent('POST', { householdId: HH_ID, id: EXPENSE_ID }),
    )

    expect(prismaMocks.expenseTransaction.update).not.toHaveBeenCalled()
    expect(result).toEqual({ data: { kind: 'expense', restored: true, alreadyActive: true } })
  })

  it('returns 404 when the row does not exist for this household', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue(null)

    await expect(
      restoreExpenseHandler(makeEvent('POST', { householdId: HH_ID, id: EXPENSE_ID })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does NOT filter by deletedAt in the lookup (we want the soft-deleted row)', async () => {
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({
      id: EXPENSE_ID,
      deletedAt: new Date(),
    })

    await restoreExpenseHandler(makeEvent('POST', { householdId: HH_ID, id: EXPENSE_ID }))

    const whereArg = prismaMocks.expenseTransaction.findFirst.mock.calls[0][0]?.where
    // Wichtig: kein `deletedAt: null` — wir wollen gerade die soft-deletete Zeile finden
    expect(whereArg.deletedAt).toBeUndefined()
    expect(whereArg).toMatchObject({ id: EXPENSE_ID, householdId: HH_ID })
  })
})

describe('POST /incomes/:id/restore — restore soft-deleted row (issue #58)', () => {
  it('sets deletedAt = null on a soft-deleted row', async () => {
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue({
      id: INCOME_ID,
      deletedAt: new Date(),
    })
    prismaMocks.incomeTransaction.update.mockResolvedValue({ id: INCOME_ID, deletedAt: null })

    const result = await restoreIncomeHandler(
      makeEvent('POST', { householdId: HH_ID, id: INCOME_ID }),
    )

    expect(prismaMocks.incomeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INCOME_ID },
        data: { deletedAt: null },
      }),
    )
    expect(result).toEqual({ data: { kind: 'income', restored: true } })
  })

  it('is idempotent: restore on an already-active row returns 200 without update', async () => {
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue({
      id: INCOME_ID,
      deletedAt: null,
    })

    const result = await restoreIncomeHandler(
      makeEvent('POST', { householdId: HH_ID, id: INCOME_ID }),
    )

    expect(prismaMocks.incomeTransaction.update).not.toHaveBeenCalled()
    expect(result).toEqual({ data: { kind: 'income', restored: true, alreadyActive: true } })
  })
})
