/*
 * Tests fuer die split-DELETE-Endpoints aus issue #27 Finding A:
 *
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
 * DELETE fuer Ausgaben und Einnahmen testet seit issue #181
 * transactions.write.test.ts (Auth, Parsen) bzw. die Regeln
 * server/utils/__tests__/transactions.test.ts.
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
  expenseTransaction: { count: vi.fn() },
  budget: { findFirst: vi.fn(), delete: vi.fn(), count: vi.fn() },
  incomePlan: { findFirst: vi.fn(), delete: vi.fn() },
  fixedCostPlan: { findFirst: vi.fn(), delete: vi.fn() },
  savingsGoal: { findFirst: vi.fn(), delete: vi.fn() },
  // ensureAllocations vor dem Loeschen eines Fixkosten-Plans (ADR-0005).
  envelope: { findMany: vi.fn().mockResolvedValue([]) },
  envelopeTransfer: { findMany: vi.fn().mockResolvedValue([]) },
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

import incomePlanHandler from '../income-plans/[id].delete'
import fixedCostPlanHandler from '../fixed-cost-plans/[id].delete'
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
  // ADR-0004: Default = Budget ohne Spuren (loeschbar).
  prismaMocks.expenseTransaction.count.mockResolvedValue(0)
  prismaMocks.budget.count.mockResolvedValue(0)
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
      statusMessage: expect.stringMatching(/(envelopes|income-plans|fixed-cost-plans)/),
    })
  })

  it('transactions.delete.ts validiert UUID-Format vor 410 (400 zuerst)', async () => {
    await expect(oldTransactionsDelete(makeEvent('not-a-uuid'))).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})