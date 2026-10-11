/*
 * POST /api/households/:householdId/budgets/:id/close (ADR-0004)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  budget: { findFirst: vi.fn(), update: vi.fn() },
  budgetVersion: { deleteMany: vi.fn() },
  expenseTransaction: { count: vi.fn() },
  savingsGoalExecution: { count: vi.fn() },
  $transaction: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdOwner: vi.fn(),
}))

const readBodyMock = vi.hoisted(() => vi.fn())
vi.mock('h3', async (importActual) => {
  const actual = await importActual<typeof import('h3')>()
  return { ...actual, readBody: readBodyMock }
})

vi.mock('../../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../../utils/household-access', () => ({
  requireHouseholdOwner: authMocks.requireHouseholdOwner,
}))

import handler from '../[id]/close.post'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const BUDGET_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const TARGET_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'

function makeEvent(): H3Event {
  return { context: { params: { householdId: HH_ID, id: BUDGET_ID } } } as unknown as H3Event
}

const weekly = {
  id: BUDGET_ID,
  householdId: HH_ID,
  frequency: 'WEEKLY',
  balanceSince: new Date(2026, 8, 14, 12),
  closedAt: null,
}
const monthly = {
  id: TARGET_ID,
  householdId: HH_ID,
  frequency: 'MONTHLY',
  balanceSince: new Date(2026, 9, 1, 12),
  closedAt: null,
}

function arrangeBudgets(budget: unknown, target: unknown) {
  prismaMocks.budget.findFirst.mockImplementation(async (args: any) =>
    args.where.id === BUDGET_ID ? budget : args.where.id === TARGET_ID ? target : null,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdOwner.mockResolvedValue({ user: { id: 'u1' }, membership: { role: 'OWNER' } })
  prismaMocks.expenseTransaction.count.mockResolvedValue(0)
  prismaMocks.savingsGoalExecution.count.mockResolvedValue(0)
  prismaMocks.$transaction.mockImplementation(async (fn: (tx: typeof prismaMocks) => unknown) => fn(prismaMocks))
  prismaMocks.budget.update.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }))
})

describe('POST /budgets/:id/close', () => {
  it('closes the budget into the target and drops versions from the closing date on', async () => {
    arrangeBudgets(weekly, monthly)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-05', carryoverToBudgetId: TARGET_ID })

    const response = await handler(makeEvent())

    expect(response).toEqual({
      data: {
        kind: 'budget',
        item: expect.objectContaining({ id: BUDGET_ID, carryoverToBudgetId: TARGET_ID, closedAt: expect.any(Date) }),
      },
    })
    expect(prismaMocks.budgetVersion.deleteMany).toHaveBeenCalledWith({
      where: { budgetId: BUDGET_ID, validFrom: { gte: expect.any(Date) } },
    })
    // Ziel im selben Haushalt nachgeschlagen
    expect(prismaMocks.budget.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID, householdId: HH_ID } }),
    )
  })

  it('requires OWNER', async () => {
    authMocks.requireHouseholdOwner.mockRejectedValue({ statusCode: 403 })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('requires a target budget', async () => {
    arrangeBudgets(weekly, monthly)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-05' })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 for an unknown budget', async () => {
    arrangeBudgets(null, monthly)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-05', carryoverToBudgetId: TARGET_ID })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a closing date that is not a period start', async () => {
    arrangeBudgets(weekly, monthly)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-06', carryoverToBudgetId: TARGET_ID })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.budget.update).not.toHaveBeenCalled()
  })

  it('returns 409 while bookings exist on or after the closing date', async () => {
    arrangeBudgets(weekly, monthly)
    prismaMocks.expenseTransaction.count.mockResolvedValue(2)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-05', carryoverToBudgetId: TARGET_ID })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 409 })
    expect(prismaMocks.expenseTransaction.count).toHaveBeenCalledWith({
      where: { budgetId: BUDGET_ID, deletedAt: null, date: { gte: expect.any(Date) } },
    })
    expect(prismaMocks.budget.update).not.toHaveBeenCalled()
  })

  it('returns 409 while savings transfers exist on or after the closing date', async () => {
    arrangeBudgets(weekly, monthly)
    prismaMocks.savingsGoalExecution.count.mockResolvedValue(1)
    readBodyMock.mockResolvedValueOnce({ closedAt: '2026-10-05', carryoverToBudgetId: TARGET_ID })
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 409 })
  })
})
