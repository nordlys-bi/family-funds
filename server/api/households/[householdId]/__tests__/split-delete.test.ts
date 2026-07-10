/*
 * Tests fuer die split-DELETE-Endpoints aus issue #27 Finding A:
 *
 *   DELETE /api/households/:householdId/expenses/:id
 *   DELETE /api/households/:householdId/incomes/:id
 *   DELETE /api/households/:householdId/budgets/:id
 *   DELETE /api/households/:householdId/income-plans/:id
 *   DELETE /api/households/:householdId/fixed-cost-plans/:id
 *   DELETE /api/households/:householdId/savings-goals/:id
 *
 * Vor Sprint 3: ein einziger fat DELETE mit JSON-Body `{ kind, id }` —
 * REST-Verletzung (Body bei DELETE), CORS-inkompatibel, kein Path-Param.
 * Nach Sprint 3: jede Resource hat einen eigenen DELETE mit ID im Path
 * und nutzt den ApiResponse-Envelope.
 *
 * Was getestet wird:
 *  - Happy-Path: erfolgreiches Loeschen liefert `{ data: { kind, deleted: true } }`
 *  - 404 wenn die ID nicht zum Household gehoert
 *  - 403 wenn der User kein Member ist
 *  - 400 wenn die ID kein UUID ist
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  // issue #58: Transaction-DELETE ist Soft-Delete (update mit deletedAt),
  // nicht Hard-Delete. Mock spiegelt die echte Prisma-Client-API.
  expenseTransaction: { findFirst: vi.fn(), update: vi.fn() },
  incomeTransaction: { findFirst: vi.fn(), update: vi.fn() },
  budget: { findFirst: vi.fn(), delete: vi.fn() },
  incomePlan: { findFirst: vi.fn(), delete: vi.fn() },
  fixedCostPlan: { findFirst: vi.fn(), delete: vi.fn() },
  savingsGoal: { findFirst: vi.fn(), delete: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
  requireHouseholdOwner: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
  requireHouseholdOwner: authMocks.requireHouseholdOwner,
}))

import expenseHandler from '../expenses/[id].delete'
import incomeHandler from '../incomes/[id].delete'
import budgetHandler from '../budgets/[id].delete'
import incomePlanHandler from '../income-plans/[id].delete'
import fixedCostPlanHandler from '../fixed-cost-plans/[id].delete'
import savingsGoalHandler from '../savings-goals/[id].delete'
// 410 Gone Tombstones
import oldTransactionsDelete from '../transactions.delete'
import oldPlanningDelete from '../planning.delete'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const ITEM_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeEvent(householdId = HH_ID, id = ITEM_ID): H3Event {
  return {
    context: { params: { householdId, id } },
  } as unknown as H3Event
}

function mockMember() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: 'MEMBER' },
  })
}

function mockOwner() {
  authMocks.requireHouseholdOwner.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: 'OWNER' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /households/:id/expenses/:expenseId', () => {
  it('returns the envelope `{ data: { kind, deleted: true } }` on success', async () => {
    mockMember()
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.expenseTransaction.update.mockResolvedValue({ id: ITEM_ID, deletedAt: new Date() })

    const response = await expenseHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'expense', deleted: true } })
    // Soft-Delete (issue #58): update mit deletedAt statt delete.
    expect(prismaMocks.expenseTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('scopes the lookup to the household (cross-household protection)', async () => {
    mockMember()
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue({ id: ITEM_ID })

    await expenseHandler(makeEvent())

    expect(prismaMocks.expenseTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ITEM_ID,
          householdId: HH_ID,
          deletedAt: null,
        }),
      }),
    )
  })

  it('throws 404 when the expense is not in this household', async () => {
    mockMember()
    prismaMocks.expenseTransaction.findFirst.mockResolvedValue(null)

    await expect(expenseHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('Expense'),
    })
  })

  it('rejects non-Members with 403', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })

    await expect(expenseHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(prismaMocks.expenseTransaction.findFirst).not.toHaveBeenCalled()
  })

  it('rejects malformed IDs with 400', async () => {
    mockMember()
    await expect(expenseHandler(makeEvent(HH_ID, 'not-a-uuid'))).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe('DELETE /households/:id/incomes/:incomeId', () => {
  it('returns the envelope on success', async () => {
    mockMember()
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.incomeTransaction.update.mockResolvedValue({ id: ITEM_ID, deletedAt: new Date() })

    const response = await incomeHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'income', deleted: true } })
    expect(prismaMocks.incomeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('throws 404 when income not found', async () => {
    mockMember()
    prismaMocks.incomeTransaction.findFirst.mockResolvedValue(null)
    await expect(incomeHandler(makeEvent())).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /households/:id/budgets/:budgetId (owner-only)', () => {
  it('returns the envelope on success', async () => {
    mockOwner()
    prismaMocks.budget.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.budget.delete.mockResolvedValue({ id: ITEM_ID })

    const response = await budgetHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'budget', deleted: true } })
  })

  it('requires OWNER (rejects plain Members)', async () => {
    authMocks.requireHouseholdOwner.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'Only owners can manage this household.',
    })
    await expect(budgetHandler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 404 when budget not in household', async () => {
    mockOwner()
    prismaMocks.budget.findFirst.mockResolvedValue(null)
    await expect(budgetHandler(makeEvent())).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /households/:id/income-plans/:planId', () => {
  it('returns the envelope on success', async () => {
    mockOwner()
    prismaMocks.incomePlan.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.incomePlan.delete.mockResolvedValue({ id: ITEM_ID })

    const response = await incomePlanHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'incomePlan', deleted: true } })
  })

  it('throws 404 when income plan not found', async () => {
    mockOwner()
    prismaMocks.incomePlan.findFirst.mockResolvedValue(null)
    await expect(incomePlanHandler(makeEvent())).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /households/:id/fixed-cost-plans/:planId', () => {
  it('returns the envelope on success', async () => {
    mockOwner()
    prismaMocks.fixedCostPlan.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.fixedCostPlan.delete.mockResolvedValue({ id: ITEM_ID })

    const response = await fixedCostPlanHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'fixedCostPlan', deleted: true } })
  })
})

describe('DELETE /households/:id/savings-goals/:goalId', () => {
  it('returns the envelope on success', async () => {
    mockOwner()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: ITEM_ID })
    prismaMocks.savingsGoal.delete.mockResolvedValue({ id: ITEM_ID })

    const response = await savingsGoalHandler(makeEvent())

    expect(response).toEqual({ data: { kind: 'savingsGoal', deleted: true } })
  })
})

describe('410 Gone Tombstones (alte fat DELETE-Endpoints)', () => {
  it('transactions.delete.ts liefert 410 mit Hinweis auf Split-Routes', async () => {
    await expect(oldTransactionsDelete(makeEvent())).rejects.toMatchObject({
      statusCode: 410,
      statusMessage: expect.stringContaining('/expenses/'),
    })
  })

  it('planning.delete.ts liefert 410 mit Hinweis auf Split-Routes', async () => {
    await expect(oldPlanningDelete(makeEvent())).rejects.toMatchObject({
      statusCode: 410,
      statusMessage: expect.stringMatching(/(budgets|income-plans|fixed-cost-plans|savings-goals)/),
    })
  })

  it('transactions.delete.ts validiert UUID-Format vor 410 (400 zuerst)', async () => {
    await expect(oldTransactionsDelete(makeEvent('not-a-uuid'))).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})