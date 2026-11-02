import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { Role } from '@prisma/client'

/**
 * HTTP-Integration-Tests fuer `GET /api/households/:householdId/dashboard`.
 *
 * Die Prisma-Client- und Auth-Helpers werden gemockt, weil der Endpoint
 * ohne laufende DB getestet werden soll. Die Umschlag-Uebersicht
 * (`loadEnvelopeOverview`) ist ebenfalls gemockt — ihre Rechenlogik testen
 * `envelope-balance`, `envelope-allocations` und `envelope-store`; hier geht
 * es darum, dass das Dashboard sie unveraendert durchreicht und seine
 * eigenen Bloecke (Monatssummen, letzte Aktivitaet, Handlungsbedarf) richtig
 * baut.
 */

const prismaMocks = vi.hoisted(() => ({
  expenseTransaction: { findMany: vi.fn(), aggregate: vi.fn() },
  incomeTransaction: { findMany: vi.fn(), aggregate: vi.fn() },
  // Issue #98: Recurring-Coverage-Queries fuer den Handlungsbedarf-Block.
  fixedCostPlan: { findMany: vi.fn() },
  incomePlan: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

const overviewMocks = vi.hoisted(() => ({
  loadEnvelopeOverview: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))
vi.mock('../../../../utils/envelope-overview', () => ({
  loadEnvelopeOverview: overviewMocks.loadEnvelopeOverview,
}))

// Import nach den Mocks.
import handler from '../dashboard.get'

function makeEvent(householdId: string | undefined): H3Event {
  return { context: { params: { householdId } } } as unknown as H3Event
}

const sampleUser = { id: 'user-1', email: 'jan@example.com', displayName: 'Jan' }
const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

const emptyOverview = {
  envelopes: [],
  unassigned: { balance: 0, reserved: 0, free: 0, ledgerSince: new Date(2026, 10, 2, 12), openingBalance: 0 },
}

function mockAuthSuccess() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: sampleUser,
    membership: { id: 'm-1', userId: sampleUser.id, householdId: HH_ID, role: Role.MEMBER },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([])
  prismaMocks.expenseTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.incomeTransaction.findMany.mockResolvedValue([])
  prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
  prismaMocks.fixedCostPlan.findMany.mockResolvedValue([])
  prismaMocks.incomePlan.findMany.mockResolvedValue([])
  overviewMocks.loadEnvelopeOverview.mockResolvedValue(emptyOverview)
})

describe('GET /api/households/:id/dashboard — Auth', () => {
  it('returns 401 when the user is not authenticated', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({ statusCode: 401, statusMessage: 'Authentication required.' })
    await expect(handler(makeEvent(HH_ID))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when the user is authenticated but not a household member', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({ statusCode: 403, statusMessage: 'You do not have access to this household.' })
    await expect(handler(makeEvent(HH_ID))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 400 when householdId is missing', async () => {
    await expect(handler(makeEvent(undefined))).rejects.toMatchObject({ statusCode: 400 })
    expect(authMocks.requireHouseholdMembership).not.toHaveBeenCalled()
  })
})

describe('GET /api/households/:id/dashboard — Empty State', () => {
  it('returns zero-everything response for a freshly created household', async () => {
    mockAuthSuccess()

    const response = await handler(makeEvent(HH_ID))

    expect(response.monthSummary).toEqual({ income: 0, expenses: 0, balance: 0, unassignedExpenses: 0 })
    expect(response.envelopes).toEqual([])
    expect(response.unassigned).toEqual(emptyOverview.unassigned)
    expect(response.recentActivity).toEqual([])
    expect(response.recurringDue).toEqual({ fixedCostsOpen: 0, fixedCostsDue: 0, incomeOpen: 0, incomeDue: 0 })
  })
})

describe('GET /api/households/:id/dashboard — Umschlaege (ADR-0005)', () => {
  it('passes the envelope overview through unchanged', async () => {
    mockAuthSuccess()
    const overview = {
      envelopes: [{ id: 'env-food', name: 'Lebensmittel', group: 'RUNNING', severity: 'ok' }],
      unassigned: { balance: 50000, reserved: 120000, free: -70000, ledgerSince: new Date(2026, 10, 2, 12), openingBalance: 0 },
    }
    overviewMocks.loadEnvelopeOverview.mockResolvedValue(overview)

    const response = await handler(makeEvent(HH_ID))

    expect(overviewMocks.loadEnvelopeOverview).toHaveBeenCalledWith(HH_ID, expect.any(Date))
    expect(response.envelopes).toBe(overview.envelopes)
    expect(response.unassigned).toBe(overview.unassigned)
  })
})

describe('GET /api/households/:id/dashboard — monthSummary', () => {
  it('sums income and expenses of the month and counts expenses without envelope', async () => {
    mockAuthSuccess()
    prismaMocks.incomeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 400000 } })
    prismaMocks.expenseTransaction.aggregate.mockImplementation(async (args: any) => (
      args?.where?.envelopeId === null ? { _sum: { amount: 4200 } } : { _sum: { amount: 150000 } }
    ))

    const response = await handler(makeEvent(HH_ID))

    expect(response.monthSummary).toEqual({ income: 400000, expenses: 150000, balance: 250000, unassignedExpenses: 4200 })
    // Fixkosten zaehlen nicht als "ohne Umschlag", wie `?unassigned=1`.
    const unassignedCall = prismaMocks.expenseTransaction.aggregate.mock.calls.find((call: any[]) => call[0]?.where?.envelopeId === null)
    expect(unassignedCall?.[0].where).toMatchObject({ envelopeId: null, fixedCostPlanId: null, deletedAt: null })
  })
})

describe('GET /api/households/:id/dashboard — recurringDue (issue #98)', () => {
  it('zaehlt faellige, ungedeckte Fixkosten- und Einnahmen-Plaene', async () => {
    mockAuthSuccess()

    // Zwei monatliche Fixkosten-Plaene, aktiv seit letztem Monat.
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    prismaMocks.fixedCostPlan.findMany.mockResolvedValue([
      { id: 'fc-1', startDate: lastMonth, endDate: null, frequency: 'MONTHLY' },
      { id: 'fc-2', startDate: lastMonth, endDate: null, frequency: 'MONTHLY' },
    ])
    prismaMocks.incomePlan.findMany.mockResolvedValue([
      { id: 'ip-1', startDate: lastMonth, endDate: null, frequency: 'MONTHLY' },
    ])
    // fc-1 hat diesen Monat schon eine Buchung (= gedeckt), fc-2 nicht.
    prismaMocks.expenseTransaction.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.fixedCostPlanId) return [{ date: new Date(), fixedCostPlanId: 'fc-1' }]
      return []
    })

    const response = await handler(makeEvent(HH_ID))

    expect(response.recurringDue).toEqual({ fixedCostsOpen: 1, fixedCostsDue: 2, incomeOpen: 1, incomeDue: 1 })
  })
})

describe('GET /api/households/:id/dashboard — recentActivity', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000)
  const expense = (id: string, date: Date, envelope: { name: string } | null = null) => ({
    id, amount: 100, description: id, date, envelopeId: envelope ? `env-${id}` : null, envelope, user: { displayName: 'Jan' },
  })

  it('returns at most 5 entries from the last 7 days, newest first, with the envelope name', async () => {
    mockAuthSuccess()
    prismaMocks.expenseTransaction.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.envelope === undefined) return []
      return [
        expense('e1', daysAgo(1), { name: 'Lebensmittel' }),
        expense('e2', daysAgo(2)),
        expense('e3', daysAgo(3)),
        expense('e4', daysAgo(5)),
        expense('old', daysAgo(8)),
      ]
    })
    prismaMocks.incomeTransaction.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.incomePlanId) return []
      return [
        { id: 'i1', amount: 5000, description: 'Verkauf', date: daysAgo(0.5), user: { displayName: 'Sarah' } },
        { id: 'i2', amount: 5000, description: 'alt', date: daysAgo(6), user: { displayName: 'Sarah' } },
      ]
    })

    const response = await handler(makeEvent(HH_ID))

    expect(response.recentActivity.map((entry) => entry.id)).toEqual(['i1', 'e1', 'e2', 'e3', 'e4'])
    expect(response.recentActivity[1]).toMatchObject({ budgetId: 'env-e1', budgetName: 'Lebensmittel' })
  })
})
