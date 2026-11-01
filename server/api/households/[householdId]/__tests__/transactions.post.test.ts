/*
 * Tests fuer `POST /api/households/:id/transactions` — Fokus auf den
 * Income-Pfad (issue #105).
 *
 * Regression: ein frueherer Stand (#59-Polish) hat `budgetId` an
 * `prisma.incomeTransaction.create` durchgereicht. `IncomeTransaction`
 * hat kein `budgetId`-Feld im Schema → Prisma-Validierungsfehler → jede
 * Einnahme-Erfassung schlug mit HTTP 400 fehl.
 *
 * Mock-Strategie wie transactions.soft-delete.test.ts: Prisma-Client und
 * Auth-Layer gemockt, die Money/Date/Kind-Utils laufen echt. h3's
 * readBody liest `event.node.req.body`, wenn dort bereits ein Objekt
 * steht.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  expenseTransaction: { create: vi.fn() },
  incomeTransaction: { create: vi.fn() },
  budget: { findFirst: vi.fn() },
  envelope: { findFirst: vi.fn() },
  fixedCostPlan: { findFirst: vi.fn() },
  incomePlan: { findFirst: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import handler from '../transactions.post'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(body: Record<string, unknown>): H3Event {
  return {
    context: { params: { householdId: HH_ID } },
    method: 'POST',
    node: {
      req: {
        url: '',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        body,
      },
      res: {},
    },
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
  prismaMocks.expenseTransaction.create.mockResolvedValue({ id: 'e-1' })
  prismaMocks.incomeTransaction.create.mockResolvedValue({ id: 'i-1' })
})

describe('POST /transactions — income (issue #105)', () => {
  it('creates an income transaction without passing budgetId to prisma', async () => {
    await handler(
      makeEvent({ kind: 'income', amount: 2500, date: '2026-08-27', description: 'Gehalt' }),
    )

    expect(prismaMocks.incomeTransaction.create).toHaveBeenCalledTimes(1)
    const data = prismaMocks.incomeTransaction.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('budgetId')
    expect(data).toMatchObject({
      householdId: HH_ID,
      userId: 'user-1',
      amount: 250000,
      description: 'Gehalt',
      incomePlanId: null,
    })
  })

  it('ignores a budgetId sent in the body for income (no budget lookup, not persisted)', async () => {
    await handler(
      makeEvent({ kind: 'income', amount: 1000, date: '2026-08-27', budgetId: 'some-budget-id' }),
    )

    const data = prismaMocks.incomeTransaction.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('budgetId')
    expect(prismaMocks.budget.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the incomePlanId does not belong to the household', async () => {
    prismaMocks.incomePlan.findFirst.mockResolvedValue(null)

    await expect(
      handler(makeEvent({ kind: 'income', amount: 1000, date: '2026-08-27', incomePlanId: 'p-1' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('links a valid incomePlanId', async () => {
    prismaMocks.incomePlan.findFirst.mockResolvedValue({ id: 'p-1' })

    await handler(
      makeEvent({ kind: 'income', amount: 1000, date: '2026-08-27', incomePlanId: 'p-1' }),
    )

    const data = prismaMocks.incomeTransaction.create.mock.calls[0][0].data
    expect(data.incomePlanId).toBe('p-1')
  })
})

describe('POST /transactions — expense envelope assignment (regression guard)', () => {
  it('passes a valid envelopeId through to the expense create', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: null })

    await handler(
      makeEvent({ kind: 'expense', amount: 5000, date: '2026-08-27', envelopeId: 'env-1' }),
    )

    const data = prismaMocks.expenseTransaction.create.mock.calls[0][0].data
    expect(data.envelopeId).toBe('env-1')
    expect(data).not.toHaveProperty('budgetId')
  })

  it('still accepts the old budgetId name for expenses (until #156)', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: null })

    await handler(
      makeEvent({ kind: 'expense', amount: 5000, date: '2026-08-27', budgetId: 'b-1' }),
    )

    const data = prismaMocks.expenseTransaction.create.mock.calls[0][0].data
    expect(data.envelopeId).toBe('b-1')
  })

  it('404s for an envelope outside the household', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(null)

    await expect(
      handler(makeEvent({ kind: 'expense', amount: 5000, date: '2026-08-27', envelopeId: 'env-x' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('inherits the envelope of its fixed-cost plan', async () => {
    prismaMocks.fixedCostPlan.findFirst.mockResolvedValue({ id: 'fc-1', envelopeId: 'env-housing' })
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: null })

    await handler(makeEvent({ kind: 'expense', amount: 95000, date: '2026-11-01', fixedCostPlanId: 'fc-1' }))

    const data = prismaMocks.expenseTransaction.create.mock.calls[0][0].data
    expect(data).toMatchObject({ envelopeId: 'env-housing', fixedCostPlanId: 'fc-1' })
  })
})

describe('POST /transactions — Gutschrift auf einen Umschlag (ADR-0005)', () => {
  it('credits an income to the given envelope', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: null })

    await handler(makeEvent({ kind: 'income', amount: 2500, date: '2026-11-03', envelopeId: 'env-kids' }))

    const data = prismaMocks.incomeTransaction.create.mock.calls[0][0].data
    expect(data.envelopeId).toBe('env-kids')
  })

  it('inherits the envelope of its income plan', async () => {
    prismaMocks.incomePlan.findFirst.mockResolvedValue({ id: 'p-1', envelopeId: 'env-kids' })
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: null })

    await handler(makeEvent({ kind: 'income', amount: 25500, date: '2026-11-03', incomePlanId: 'p-1' }))

    const data = prismaMocks.incomeTransaction.create.mock.calls[0][0].data
    expect(data.envelopeId).toBe('env-kids')
  })
})

describe('POST /transactions — geschlossene Umschlaege', () => {
  it('rejects an expense dated on or after the closing date', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: new Date(2026, 9, 5, 12) })

    await expect(
      handler(makeEvent({ kind: 'expense', amount: 5000, date: '2026-10-05', envelopeId: 'env-1' })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.expenseTransaction.create).not.toHaveBeenCalled()
  })

  it('still allows late bookings dated before the closing date', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ closedAt: new Date(2026, 9, 5, 12) })

    await handler(makeEvent({ kind: 'expense', amount: 5000, date: '2026-10-04', envelopeId: 'env-1' }))

    expect(prismaMocks.expenseTransaction.create).toHaveBeenCalledTimes(1)
  })
})
