/*
 * GET /api/households/:householdId/budgets — Saldo, laufende Periode,
 * Forecast und Trend fuer Budget-Liste und -Detailseite (ADR-0004).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  budget: { findMany: vi.fn() },
  expenseTransaction: { findMany: vi.fn() },
  savingsGoalExecution: { findMany: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import handler from '../budgets.get'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(): H3Event {
  return { context: { params: { householdId: HH_ID } } } as unknown as H3Event
}

function version(amount: number, validFrom: Date) {
  return { id: `v-${amount}`, amount, validFrom, createdAt: validFrom, updatedAt: validFrom }
}

const open = {
  id: 'b-open',
  key: 'food',
  name: 'Lebensmittel',
  frequency: 'MONTHLY',
  balanceSince: new Date(2026, 8, 1, 12),
  closedAt: null,
  carryoverToBudgetId: null,
  createdAt: new Date(2026, 8, 1),
  updatedAt: new Date(2026, 8, 1),
  versions: [version(30000, new Date(2026, 8, 1, 12))],
}
const closed = {
  id: 'b-closed',
  key: 'old',
  name: 'Alt',
  frequency: 'WEEKLY',
  balanceSince: new Date(2026, 8, 14, 12),
  closedAt: new Date(2026, 8, 28, 12),
  carryoverToBudgetId: 'b-open',
  createdAt: new Date(2026, 8, 1),
  updatedAt: new Date(2026, 8, 1),
  versions: [version(1000, new Date(2026, 8, 14, 12))],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 11, 15))
  authMocks.requireHouseholdMembership.mockResolvedValue({ user: { id: 'u1' }, membership: { role: 'MEMBER' } })
  prismaMocks.budget.findMany.mockResolvedValue([open, closed])
  prismaMocks.expenseTransaction.findMany.mockResolvedValue([
    { budgetId: 'b-open', amount: 5000, date: new Date(2026, 9, 5, 12) },
    { budgetId: 'b-open', amount: 2000, date: new Date(2026, 8, 20, 12) },
  ])
  prismaMocks.savingsGoalExecution.findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /budgets', () => {
  it('returns balance, current period with forecast and trend per budget', async () => {
    const result = await handler(makeEvent())
    const food = result.budgets.find((budget: { id: string }) => budget.id === 'b-open')!

    // 2 × 300 € − 70 € + Übertrag aus "Alt" (2 Wochen à 10 €)
    expect(food.balance!.balance).toBe(60000 - 7000 + 2000)
    expect(food.currentPeriod).toMatchObject({
      plannedAmount: 30000,
      spentAmount: 5000,
      remainingAmount: 25000,
      severity: 'ok',
    })
    expect(food.currentPeriod!.start.getDate()).toBe(1)
    expect(food.currentPeriod!.forecast).toMatchObject({ basisAmount: 5000 })
    expect(food.balanceTrend.at(-1)).toBe(food.balance!.balance)
  })

  it('has no current period for a closed budget', async () => {
    const result = await handler(makeEvent())
    const old = result.budgets.find((budget: { id: string }) => budget.id === 'b-closed')!
    expect(old.currentPeriod).toBeNull()
    expect(old.balance!.balance).toBe(2000)
  })
})
