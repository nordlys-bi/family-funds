/*
 * Tests fuer Soft-Delete-Filter in aggregierten GET-Endpoints (issue #65).
 *
 * Hintergrund: Nach #58 (PR #63) gibt es Soft-Delete mit 5-Sek-Undo.
 * `transactions.get.ts` filtert `deletedAt: null` per Default (siehe
 * `transactions.soft-delete.test.ts`). ABER: die aggregierten Endpoints,
 * die Budget-Auslastung, Dashboard-KPIs und Activity-Counts liefern,
 * HABEN DEN FILTER NICHT — d.h. eine soft-deletete Buchung zaehlt
 * fuer 5 Sek weiter in die Budget-Auslastung rein, und permanent
 * (weil `deletedAt` nie auf null zurueckgesetzt wird ausser durch
 * expliziten Undo oder POST /restore), was das UX-Versprechen von #58
 * bricht ("Buchung ist weg, Budget ist zurueckgerechnet").
 *
 * Diese Tests pruefen explizit, dass jeder betroffene aggregierte
 * Endpoint `deletedAt: null` in seine Prisma-where-Clauses packt.
 *
 * Betroffene Endpoints (Stand Issue #65):
 *   - GET /api/households/:id/budget-overview
 *   - GET /api/households/:id/dashboard
 *   - GET /api/households/:id/activity
 *
 * NICHT betroffen (sind schon korrekt bzw. nicht relevant):
 *   - GET /api/households/:id/transactions  -- siehe
 *     transactions.soft-delete.test.ts, hat den Filter schon
 *   - DELETE /expenses/:id, /incomes/:id   -- schreiben deletedAt, lesen nicht
 *   - POST  /expenses/:id/restore, ...      -- schreiben deletedAt = null
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

// ---------------------------------------------------------------------------
// Mock-Slots: vi.hoisted, weil vi.mock vor allen Imports aufgeloest wird.
// ---------------------------------------------------------------------------

const prismaMocks = vi.hoisted(() => ({
  budget: { findMany: vi.fn(), count: vi.fn() },
  expenseTransaction: { findMany: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
  incomeTransaction: { findMany: vi.fn(), aggregate: vi.fn() },
  savingsGoal: { findMany: vi.fn() },
  householdMember: { count: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

// Handler-Imports NACH den vi.mock-Calls.
import budgetOverviewHandler from '../budget-overview.get'
import dashboardHandler from '../dashboard.get'
import activityHandler from '../activity.get'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(householdId: string | undefined, query: Record<string, string> = {}): H3Event {
  const search = new URLSearchParams(query).toString()
  const path = search ? `?${search}` : ''
  return {
    context: { params: { householdId } },
    method: 'GET',
    path,
    node: {
      req: { url: path, headers: {} },
      res: {},
    },
  } as unknown as H3Event
}

function mockAuthSuccess() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess()
  // Default: leere Results, damit handler nicht crashen, wenn ein
  // Test die Mocks nicht explizit setzt.
  prismaMocks.budget.findMany.mockResolvedValue([])
  prismaMocks.budget.count.mockResolvedValue(0)
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.savingsGoal.findMany.mockResolvedValue([])
  prismaMocks.householdMember.count.mockResolvedValue(0)
  prismaMocks.expenseTransaction.count.mockResolvedValue(0)
})

// ---------------------------------------------------------------------------
// budget-overview
// ---------------------------------------------------------------------------

describe('GET /budget-overview — soft-delete filter (issue #65)', () => {
  it('applies deletedAt: null to the month-expense findMany', async () => {
    await budgetOverviewHandler(makeEvent(HH_ID))

    // Mindestens ein findMany-Call auf expenseTransaction muss
    // deletedAt: null im where-Clause haben. Wir pruefen alle
    // Calls, weil der Handler in Zukunft mehr hinzufuegen koennte.
    const findManyCalls = prismaMocks.expenseTransaction.findMany.mock.calls
    expect(findManyCalls.length).toBeGreaterThan(0)
    for (const call of findManyCalls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }
  })
})

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

describe('GET /dashboard — soft-delete filter (issue #65)', () => {
  it('applies deletedAt: null to ALL expense and income queries (4 Stellen)', async () => {
    await dashboardHandler(makeEvent(HH_ID))

    // 1× expenseTransaction.findMany (monthExpenses)
    // 1× expenseTransaction.findMany (recentExpenses)
    // 1× incomeTransaction.findMany (recentIncomes)
    // 1× incomeTransaction.aggregate (monthIncomeTotal)
    const expenseCalls = prismaMocks.expenseTransaction.findMany.mock.calls
    expect(expenseCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of expenseCalls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }

    const incomeFindManyCalls = prismaMocks.incomeTransaction.findMany.mock.calls
    expect(incomeFindManyCalls.length).toBeGreaterThan(0)
    for (const call of incomeFindManyCalls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }

    const incomeAggregateCalls = prismaMocks.incomeTransaction.aggregate.mock.calls
    expect(incomeAggregateCalls.length).toBeGreaterThan(0)
    for (const call of incomeAggregateCalls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }
  })
})

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------

describe('GET /activity — soft-delete filter (issue #65)', () => {
  it('applies deletedAt: null to the expenseTransaction.count', async () => {
    await activityHandler(makeEvent(HH_ID))

    const countCalls = prismaMocks.expenseTransaction.count.mock.calls
    expect(countCalls.length).toBeGreaterThan(0)
    for (const call of countCalls) {
      expect(call[0]?.where).toMatchObject({ deletedAt: null })
    }
  })

  it('a soft-deleted transaction does not count toward the activity total', async () => {
    // Direkter Test: das Count-Mock bekommt deletedAt: null im where.
    // Die Prisma-Library wuerde dann in der Realitaet nur aktive
    // Rows zaehlen. Hier verifizieren wir den Where-Clause direkt,
    // weil das die einzige Stelle ist, an der das soft-deleted-vs-
    // active-Verhalten entschieden wird.
    await activityHandler(makeEvent(HH_ID))

    const whereArg = prismaMocks.expenseTransaction.count.mock.calls[0]?.[0]?.where
    expect(whereArg).toEqual(
      expect.objectContaining({
        householdId: HH_ID,
        deletedAt: null,
      }),
    )
  })
})
