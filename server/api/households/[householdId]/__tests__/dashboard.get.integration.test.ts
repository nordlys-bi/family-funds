import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { Frequency, Role } from '@prisma/client'

/**
 * HTTP-Integration-Tests fuer `GET /api/households/:householdId/dashboard`.
 *
 * Die Prisma-Client- und Auth-Helpers werden gemockt, weil der Endpoint
 * ohne laufende DB getestet werden soll. Das Verhalten der Aggregations-
 * Logik (`buildBudgetAlerts`, `buildRecentActivity`, `buildSavingsGoalsProgress`)
 * wird hier indirekt ueberprueft — Detailtests dafuer liegen in
 * `server/utils/__tests__/dashboard.test.ts`.
 */

// ---------------------------------------------------------------------------
// Mock-Slots: vi.hoisted, weil vi.mock vor allen Imports aufgeloest wird.
// ---------------------------------------------------------------------------

const prismaMocks = vi.hoisted(() => ({
  budget: { findMany: vi.fn() },
  expenseTransaction: { findMany: vi.fn() },
  incomeTransaction: { findMany: vi.fn() },
  savingsGoal: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

// Import nach den Mocks.
import handler from '../dashboard.get'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(householdId: string | undefined): H3Event {
  return {
    context: {
      params: { householdId },
    },
  } as unknown as H3Event
}

const sampleUser = { id: 'user-1', email: 'jan@example.com', displayName: 'Jan' }

function mockAuthSuccess() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: sampleUser,
    membership: { id: 'm-1', userId: sampleUser.id, householdId: 'h-1', role: Role.MEMBER },
  })
}

function mockAuthFailure(statusCode: number, statusMessage: string) {
  authMocks.requireHouseholdMembership.mockRejectedValue({
    statusCode,
    statusMessage,
  })
}

function resetDbMocks() {
  prismaMocks.budget.findMany.mockReset()
  prismaMocks.expenseTransaction.findMany.mockReset()
  prismaMocks.incomeTransaction.findMany.mockReset()
  prismaMocks.savingsGoal.findMany.mockReset()
}

function mockEmptyHousehold() {
  prismaMocks.budget.findMany.mockResolvedValue([])
  // 4 calls to expenseTransaction.findMany — month + recent — both empty.
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
  prismaMocks.savingsGoal.findMany.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Test-Fixture: ein typischer Haushalt mit
//  - 3 Budgets: Lebensmittel (warning, 85%), Sonstiges (unassigned, NICHT in alerts),
//    Fixkosten (over, 110%), Freizeit (ok, 30%)
//  - Monats-Expenses + Incomes
//  - 6 Transaktionen in den letzten 7 Tagen (Erwartung: nur die 5 neuesten)
//  - 2 Sparziele
// ---------------------------------------------------------------------------

function setupTypicalHousehold() {
  prismaMocks.budget.findMany.mockResolvedValue([
    {
      id: 'b-food',
      key: 'food',
      name: 'Lebensmittel',
      versions: [
        { id: 'v-1', amount: 50000, frequency: Frequency.MONTHLY, validFrom: new Date('2026-01-01') },
      ],
    },
    {
      id: 'b-fix',
      key: 'fix',
      name: 'Fixkosten',
      versions: [
        { id: 'v-2', amount: 100000, frequency: Frequency.MONTHLY, validFrom: new Date('2026-01-01') },
      ],
    },
    {
      id: 'b-leisure',
      key: 'leisure',
      name: 'Freizeit',
      versions: [
        { id: 'v-3', amount: 20000, frequency: Frequency.MONTHLY, validFrom: new Date('2026-01-01') },
      ],
    },
  ])

  // Monats-Expenses: 42500 (food, 85%) + 110000 (fix, 110%) + 6000 (leisure, 30%) + 5000 (unassigned)
  prismaMocks.expenseTransaction.findMany.mockImplementation(async (args: any) => {
    if (args?.where?.date?.gte && args?.select?.budget === undefined) {
      // Monats-Query (nur amount/date/budgetId)
      return [
        { amount: 42500, date: new Date(), budgetId: 'b-food' },
        { amount: 110000, date: new Date(), budgetId: 'b-fix' },
        { amount: 6000, date: new Date(), budgetId: 'b-leisure' },
        { amount: 5000, date: new Date(), budgetId: null },
      ]
    }
    // Recent-Query (volle Transaktion mit Joins)
    const now = new Date()
    return [
      { id: 'e-1', amount: 1200, description: 'Brot', date: new Date(now.getTime() - 1 * 86400000), budgetId: 'b-food', budget: { name: 'Lebensmittel', key: 'food' }, user: { displayName: 'Jan' } },
      { id: 'e-2', amount: 3500, description: 'Miete', date: new Date(now.getTime() - 2 * 86400000), budgetId: 'b-fix', budget: { name: 'Fixkosten', key: 'fix' }, user: { displayName: 'Jan' } },
      { id: 'e-3', amount: 850, description: 'Kino', date: new Date(now.getTime() - 4 * 86400000), budgetId: 'b-leisure', budget: { name: 'Freizeit', key: 'leisure' }, user: { displayName: 'Jan' } },
      { id: 'e-4', amount: 2300, description: 'Apfel', date: new Date(now.getTime() - 5 * 86400000), budgetId: 'b-food', budget: { name: 'Lebensmittel', key: 'food' }, user: { displayName: 'Jan' } },
      { id: 'e-5', amount: 1500, description: 'Bus', date: new Date(now.getTime() - 7 * 86400000), budgetId: null, budget: null, user: { displayName: 'Jan' } },
    ]
  })

  prismaMocks.incomeTransaction.findMany.mockImplementation(async (args: any) => {
    if (args?.where?.date?.gte && args?.select?.user === undefined) {
      // Monats-Query
      return [
        { amount: 250000 },
        { amount: 50000 },
      ]
    }
    // Recent-Query
    const now = new Date()
    return [
      { id: 'i-1', amount: 250000, description: 'Gehalt', date: new Date(now.getTime() - 3 * 86400000), user: { displayName: 'Jan' } },
      { id: 'i-2', amount: 50000, description: 'Bonus', date: new Date(now.getTime() - 6 * 86400000), user: { displayName: 'Jan' } },
    ]
  })

  prismaMocks.savingsGoal.findMany.mockResolvedValue([
    {
      id: 'g-1',
      name: 'Urlaub',
      targetAmount: 200000,
      monthlyRate: 10000,
      executions: [{ amount: 80000 }, { amount: 20000 }],
    },
    {
      id: 'g-2',
      name: 'Notgroschen',
      targetAmount: 500000,
      monthlyRate: 25000,
      executions: [{ amount: 50000 }],
    },
  ])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDbMocks()
  authMocks.requireHouseholdMembership.mockReset()
})

describe('GET /api/households/:id/dashboard — Auth', () => {
  it('returns 401 when the user is not authenticated', async () => {
    mockAuthFailure(401, 'Unauthorized')

    await expect(handler(makeEvent('h-1'))).rejects.toMatchObject({
      statusCode: 401,
    })
    // DB sollte nicht angefasst werden, wenn Auth schon scheitert.
    expect(prismaMocks.budget.findMany).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is authenticated but not a household member', async () => {
    mockAuthFailure(403, 'You do not have access to this household.')

    await expect(handler(makeEvent('h-1'))).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(prismaMocks.budget.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 when householdId is missing', async () => {
    await expect(handler(makeEvent(undefined))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(authMocks.requireHouseholdMembership).not.toHaveBeenCalled()
  })
})

describe('GET /api/households/:id/dashboard — Empty State', () => {
  it('returns zero-everything response for a freshly created household', async () => {
    mockAuthSuccess()
    mockEmptyHousehold()

    const response = await handler(makeEvent('h-1'))

    expect(response.householdId).toBe('h-1')
    expect(response.monthSummary).toEqual({
      income: 0,
      expenses: 0,
      balance: 0,
      unassignedExpenses: 0,
    })
    expect(response.budgetAlerts).toEqual([])
    expect(response.recentActivity).toEqual([])
    expect(response.savingsGoals).toEqual([])
  })
})

describe('GET /api/households/:id/dashboard — Happy Path', () => {
  it('aggregates month summary, budget alerts, recent activity and savings goals', async () => {
    mockAuthSuccess()
    setupTypicalHousehold()

    const response = await handler(makeEvent('h-1'))

    // monthSummary: income 300000, expenses 163500, balance 136500, unassigned 5000
    expect(response.monthSummary).toEqual({
      income: 300000,
      expenses: 163500,
      balance: 136500,
      unassignedExpenses: 5000,
    })
  })

  it('returns budget alerts sorted by severity (over > warning > ok)', async () => {
    mockAuthSuccess()
    setupTypicalHousehold()

    const response = await handler(makeEvent('h-1'))

    const severities = response.budgetAlerts.map((alert) => alert.severity)
    // Erwartete Reihenfolge: over (fix), warning (food), ok (leisure)
    expect(severities).toEqual(['over', 'warning', 'ok'])
  })

  it('does NOT include the "Sonstiges" unassigned bucket in budgetAlerts', async () => {
    mockAuthSuccess()
    setupTypicalHousehold()

    const response = await handler(makeEvent('h-1'))

    const keys = response.budgetAlerts.map((alert) => alert.key)
    expect(keys).not.toContain('sonstiges')
    // Aber unassignedExpenses im monthSummary ist trotzdem 5000.
    expect(response.monthSummary.unassignedExpenses).toBe(5000)
  })

  it('returns at most 5 recent activity entries, newest first, only from last 7 days', async () => {
    mockAuthSuccess()
    setupTypicalHousehold()

    const response = await handler(makeEvent('h-1'))

    expect(response.recentActivity).toHaveLength(5)

    // Neueste zuerst: e-1 (1d ago), e-2 (2d), i-1 (3d), e-3 (4d), e-4 (5d).
    // i-2 (6d ago) ist die 6. — faellt raus, weil nur die Top-5 genommen werden.
    const ids = response.recentActivity.map((entry) => entry.id)
    expect(ids).toEqual(['e-1', 'e-2', 'i-1', 'e-3', 'e-4'])

    // Sortierung: absteigend nach Datum.
    const dates = response.recentActivity.map((entry) => entry.date.getTime())
    for (let i = 1; i < dates.length; i += 1) {
      expect(dates[i - 1]!).toBeGreaterThanOrEqual(dates[i]!)
    }
  })

  it('sorts savings goals by percentToTarget descending', async () => {
    mockAuthSuccess()
    setupTypicalHousehold()

    const response = await handler(makeEvent('h-1'))

    // g-1 (Urlaub): 100000/200000 = 50%
    // g-2 (Notgroschen): 50000/500000 = 10%
    expect(response.savingsGoals.map((goal) => goal.name)).toEqual(['Urlaub', 'Notgroschen'])
    expect(response.savingsGoals[0]).toMatchObject({
      id: 'g-1',
      currentAmount: 100000,
      targetAmount: 200000,
      monthlyRate: 10000,
      percentToTarget: 50,
    })
  })
})

describe('GET /api/households/:id/dashboard — Severity-Grenzwerte', () => {
  function mockSingleBudget(plannedCents: number, spentCents: number) {
    prismaMocks.budget.findMany.mockResolvedValue([
      {
        id: 'b-1',
        key: 'food',
        name: 'Lebensmittel',
        versions: [
          { id: 'v-1', amount: plannedCents, frequency: Frequency.MONTHLY, validFrom: new Date('2026-01-01') },
        ],
      },
    ])
    prismaMocks.expenseTransaction.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.budget === undefined) {
        return [{ amount: spentCents, date: new Date(), budgetId: 'b-1' }]
      }
      return []
    })
    prismaMocks.incomeTransaction.findMany.mockImplementation(async (args: any) => {
      return args?.select?.user === undefined ? [] : []
    })
    prismaMocks.savingsGoal.findMany.mockResolvedValue([])
  }

  it('classifies exactly 80% as warning (nicht ok)', async () => {
    mockAuthSuccess()
    mockSingleBudget(10000, 8000) // 80.0%

    const response = await handler(makeEvent('h-1'))

    expect(response.budgetAlerts[0]!.severity).toBe('warning')
    expect(response.budgetAlerts[0]!.percentUsed).toBe(80)
  })

  it('classifies exactly 100% as warning (nicht over)', async () => {
    mockAuthSuccess()
    mockSingleBudget(10000, 10000) // 100.0%

    const response = await handler(makeEvent('h-1'))

    expect(response.budgetAlerts[0]!.severity).toBe('warning')
    expect(response.budgetAlerts[0]!.percentUsed).toBe(100)
  })

  it('classifies >100% as over', async () => {
    mockAuthSuccess()
    mockSingleBudget(10000, 12500) // 125.0%

    const response = await handler(makeEvent('h-1'))

    expect(response.budgetAlerts[0]!.severity).toBe('over')
    expect(response.budgetAlerts[0]!.percentUsed).toBe(125)
  })

  it('classifies 79.9% as ok', async () => {
    mockAuthSuccess()
    mockSingleBudget(10000, 7990) // 79.9%

    const response = await handler(makeEvent('h-1'))

    expect(response.budgetAlerts[0]!.severity).toBe('ok')
    expect(response.budgetAlerts[0]!.percentUsed).toBe(79.9)
  })
})

describe('GET /api/households/:id/dashboard — 7-Tage-Fenster fuer recentActivity', () => {
  it('excludes transactions older than 7 days', async () => {
    mockAuthSuccess()

    const now = new Date()
    const eightDaysAgo = new Date(now.getTime() - 8 * 86400000)
    const sixDaysAgo = new Date(now.getTime() - 6 * 86400000)

    prismaMocks.budget.findMany.mockResolvedValue([])
    prismaMocks.expenseTransaction.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.budget === undefined) return []
      return [
        // Aelter als 7 Tage — sollte rausfallen.
        { id: 'old', amount: 100, description: 'old', date: eightDaysAgo, budgetId: null, budget: null, user: { displayName: 'Jan' } },
        // Innerhalb 7 Tage — sollte bleiben.
        { id: 'new', amount: 200, description: 'new', date: sixDaysAgo, budgetId: null, budget: null, user: { displayName: 'Jan' } },
      ]
    })
    prismaMocks.incomeTransaction.findMany.mockImplementation(async () => [])
    prismaMocks.savingsGoal.findMany.mockResolvedValue([])

    const response = await handler(makeEvent('h-1'))

    expect(response.recentActivity.map((entry) => entry.id)).toEqual(['new'])
  })
})