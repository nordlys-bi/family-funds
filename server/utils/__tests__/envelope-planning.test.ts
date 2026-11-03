/*
 * Tests fuer die Planung (ADR-0005) gegen den In-Memory-Adapter: Sie pruefen,
 * was nach einer Aktion in den Zuteilungen steht, nicht in welcher Reihenfolge
 * etwas aufgerufen wurde.
 */
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryDb, type InMemoryTables } from './helpers/in-memory-db'

vi.mock('../prisma', () => ({ prisma: {} }))

const { ensureAllocations } = await import('../envelope-store')
const { closeEnvelope, createPlan, deleteFixedCostPlan, setLedgerStart, updateEnvelope, updatePlan } = await import('../envelope-planning')

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number) {
  return new Date(year, month - 1, date, 12, 0, 0, 0)
}

const HH = 'h1'
const NOV_15 = day(2026, 11, 15)
const DEC_2 = day(2026, 12, 2)

const household = { id: HH, ledgerSince: day(2026, 1, 1), openingBalance: 0 }

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'env',
    householdId: HH,
    name: 'Kinder',
    group: 'RUNNING',
    frequency: 'MONTHLY',
    balanceSince: day(2026, 10, 1),
    allocationsSince: null,
    closedAt: null,
    carryoverToEnvelopeId: null,
    allocationSource: 'FIXED',
    allocationAmount: 30000,
    ...overrides,
  }
}

function fixedCostPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan',
    householdId: HH,
    name: 'Miete',
    amount: 95000,
    frequency: 'MONTHLY',
    startDate: day(2026, 1, 1),
    endDate: null,
    envelopeId: 'env',
    ...overrides,
  }
}

const planValues = { name: 'Strom', amount: 5000, frequency: 'MONTHLY' as const, startDate: day(2026, 11, 1), endDate: null, envelopeId: 'env' }

function setup(seed: Partial<InMemoryTables> = {}) {
  const { db, tables } = createInMemoryDb({ household: [household], envelope: [envelope()], ...seed })
  return { db, tables, ctx: { db, today: NOV_15 } }
}

/** Zuteilungen eines Umschlags als `{ 'Monat': Betrag }`. */
function allocationsOf(tables: InMemoryTables, envelopeId = 'env') {
  return Object.fromEntries(
    tables.envelopeTransfer
      .filter((row) => row.toEnvelopeId === envelopeId && row.allocationPeriodStart)
      .map((row) => [row.allocationPeriodStart.getMonth() + 1, row.amount]),
  )
}

describe('updateEnvelope', () => {
  it('keeps started periods at the old amount, the next one gets the new', async () => {
    const { db, tables, ctx } = setup()
    await updateEnvelope(HH, 'env', { allocationAmount: 28000 }, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 10: 30000, 11: 30000, 12: 28000 })
  })

  it('books nothing when only name, group or target change', async () => {
    const { tables, ctx } = setup()
    await updateEnvelope(HH, 'env', { name: 'Schule', group: 'RESERVE', targetAmount: 500 }, ctx)
    expect(tables.envelopeTransfer).toEqual([])
    expect(tables.envelope[0]).toMatchObject({ name: 'Schule', group: 'RESERVE', targetAmount: 500, allocationAmount: 30000 })
  })

  it('writes the rule and other fields together', async () => {
    const { db, tables, ctx } = setup()
    const update = vi.spyOn((db as any).envelope, 'update')
    await updateEnvelope(HH, 'env', { name: 'Schule', allocationAmount: 28000 }, ctx)
    expect(update).toHaveBeenCalledTimes(1)
    expect(tables.envelope[0]).toMatchObject({ name: 'Schule', allocationAmount: 28000 })
  })

  it('starts a first rule with the next period instead of booking the past', async () => {
    const { db, tables, ctx } = setup({ envelope: [envelope({ allocationSource: 'NONE', allocationAmount: null })] })
    await updateEnvelope(HH, 'env', { allocationSource: 'FIXED', allocationAmount: 10000 }, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 12: 10000 })
  })

  it('gives a one-off envelope its one allocation for a first rule', async () => {
    const { db, tables, ctx } = setup({ envelope: [envelope({ frequency: 'ONCE', allocationSource: 'NONE', allocationAmount: null })] })
    await updateEnvelope(HH, 'env', { allocationSource: 'FIXED', allocationAmount: 10000 }, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 10: 10000 })
  })

  it('leaves the lower bound alone when an existing rule changes', async () => {
    const { tables, ctx } = setup()
    await updateEnvelope(HH, 'env', { allocationSource: 'PLANS' }, ctx)
    expect(tables.envelope[0]).toMatchObject({ allocationsSince: null, allocationSource: 'PLANS' })
  })

  it('clears the amount when switching away from a fixed allocation', async () => {
    const { tables, ctx } = setup()
    await updateEnvelope(HH, 'env', { allocationSource: 'NONE' }, ctx)
    expect(tables.envelope[0]).toMatchObject({ allocationSource: 'NONE', allocationAmount: null })
  })

  it('rejects an invalid rule without booking', async () => {
    const { tables, ctx } = setup({ envelope: [envelope({ frequency: 'ONCE' })] })
    await expect(updateEnvelope(HH, 'env', { allocationSource: 'PLANS' }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateEnvelope(HH, 'env', { allocationAmount: null }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(tables.envelopeTransfer).toEqual([])
  })

  it('404s for an envelope of another household', async () => {
    const { ctx } = setup({ envelope: [envelope({ householdId: 'other' })] })
    await expect(updateEnvelope(HH, 'env', { name: 'x' }, ctx)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('fixed-cost plans', () => {
  const fromPlans = envelope({ allocationSource: 'PLANS', allocationAmount: null, balanceSince: day(2026, 11, 1) })

  it('createPlan: a new plan only counts from the next period', async () => {
    const { db, tables, ctx } = setup({ envelope: [fromPlans], fixedCostPlan: [fixedCostPlan()] })
    await createPlan(HH, 'fixedCostPlan', planValues, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 11: 95000, 12: 100000 })
  })

  it('updatePlan: a new amount only counts from the next period', async () => {
    const { db, tables, ctx } = setup({ envelope: [fromPlans], fixedCostPlan: [fixedCostPlan()] })
    await updatePlan(HH, 'fixedCostPlan', 'plan', { amount: 100000 }, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 11: 95000, 12: 100000 })
  })

  it('updatePlan: moving a plan keeps the started period of the old envelope', async () => {
    const other = envelope({ id: 'other', allocationSource: 'PLANS', allocationAmount: null, balanceSince: day(2026, 12, 1) })
    const { db, tables, ctx } = setup({ envelope: [fromPlans, other], fixedCostPlan: [fixedCostPlan()] })
    await updatePlan(HH, 'fixedCostPlan', 'plan', { envelopeId: 'other' }, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 11: 95000, 12: 0 })
    expect(allocationsOf(tables, 'other')).toEqual({ 12: 95000 })
  })

  it('updatePlan: leaves fields without a value alone', async () => {
    const { tables, ctx } = setup({ fixedCostPlan: [fixedCostPlan()] })
    await updatePlan(HH, 'fixedCostPlan', 'plan', { name: 'Kaltmiete', envelopeId: undefined }, ctx)
    expect(tables.fixedCostPlan[0]).toMatchObject({ name: 'Kaltmiete', amount: 95000, envelopeId: 'env' })
  })

  it('deleteFixedCostPlan: the started period keeps its money', async () => {
    const { db, tables, ctx } = setup({ envelope: [fromPlans], fixedCostPlan: [fixedCostPlan()] })
    await deleteFixedCostPlan(HH, 'plan', ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(tables.fixedCostPlan).toEqual([])
    expect(allocationsOf(tables)).toEqual({ 11: 95000, 12: 0 })
  })

  it('books even for a plan without an envelope', async () => {
    const { tables, ctx } = setup()
    await createPlan(HH, 'fixedCostPlan', { ...planValues, envelopeId: null }, ctx)
    expect(allocationsOf(tables)).toEqual({ 10: 30000, 11: 30000 })
  })

  it('404s for an unknown plan or foreign envelope', async () => {
    const { ctx } = setup({ fixedCostPlan: [fixedCostPlan({ householdId: 'other' })] })
    await expect(updatePlan(HH, 'fixedCostPlan', 'plan', { name: 'x' }, ctx)).rejects.toMatchObject({ statusCode: 404 })
    await expect(deleteFixedCostPlan(HH, 'plan', ctx)).rejects.toMatchObject({ statusCode: 404 })
    await expect(createPlan(HH, 'fixedCostPlan', { ...planValues, envelopeId: 'missing' }, ctx)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('income plans', () => {
  it('do not book allocations', async () => {
    const { tables, ctx } = setup({ incomePlan: [fixedCostPlan({ id: 'income' })] })
    await createPlan(HH, 'incomePlan', planValues, ctx)
    await updatePlan(HH, 'incomePlan', 'income', { amount: 100 }, ctx)
    expect(tables.envelopeTransfer).toEqual([])
    expect(tables.incomePlan).toHaveLength(2)
    expect(tables.incomePlan[0]).toMatchObject({ amount: 100 })
  })

  it('404s for an unknown plan', async () => {
    const { ctx } = setup()
    await expect(updatePlan(HH, 'incomePlan', 'missing', { amount: 100 }, ctx)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('closeEnvelope', () => {
  const CLOSE_NOV = day(2026, 11, 1)

  it('books up to the closing date and removes allocations from it on', async () => {
    const { db, tables, ctx } = setup()
    await closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)
    await ensureAllocations(HH, DEC_2, db)
    expect(allocationsOf(tables)).toEqual({ 10: 30000 })
    expect(tables.envelope[0]).toMatchObject({ closedAt: CLOSE_NOV, carryoverToEnvelopeId: null })
  })

  it('closes into another open envelope', async () => {
    const { tables, ctx } = setup({ envelope: [envelope(), envelope({ id: 'other' })] })
    await closeEnvelope(HH, 'env', CLOSE_NOV, 'other', ctx)
    expect(tables.envelope[0]).toMatchObject({ carryoverToEnvelopeId: 'other' })
  })

  it.each([
    ['open-ended', { frequency: 'MONTHLY', endDate: null }],
    ['ending later', { frequency: 'MONTHLY', endDate: day(2026, 12, 31) }],
    ['one-off later', { frequency: 'ONCE', startDate: day(2026, 12, 1), endDate: null }],
  ])('blocks while a %s plan runs past the closing date', async (_name, plan) => {
    for (const table of ['fixedCostPlan', 'incomePlan']) {
      const { tables, ctx } = setup({ [table]: [fixedCostPlan(plan)] })
      await expect(closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'active-plans' } })
      expect(tables.envelope[0]).toMatchObject({ closedAt: null })
    }
  })

  it.each([
    ['ended', { frequency: 'MONTHLY', endDate: day(2026, 10, 31) }],
    ['one-off earlier', { frequency: 'ONCE', startDate: day(2026, 10, 15), endDate: null }],
  ])('is not blocked by an %s plan', async (_name, plan) => {
    const { tables, ctx } = setup({ fixedCostPlan: [fixedCostPlan(plan)] })
    await closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)
    expect(tables.envelope[0]).toMatchObject({ closedAt: CLOSE_NOV })
  })

  it.each([
    ['expense', { expenseTransaction: [{ id: 'x', envelopeId: 'env', deletedAt: null, date: CLOSE_NOV }] }],
    ['income', { incomeTransaction: [{ id: 'x', envelopeId: 'env', deletedAt: null, date: CLOSE_NOV }] }],
    ['transfer', { envelopeTransfer: [{ id: 'x', fromEnvelopeId: 'env', toEnvelopeId: null, allocationPeriodStart: null, date: CLOSE_NOV }] }],
  ])('blocks when a later %s exists', async (_name, seed) => {
    const { tables, ctx } = setup(seed)
    await expect(closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.envelope[0]).toMatchObject({ closedAt: null })
  })

  it('is not blocked by a soft-deleted booking', async () => {
    const { tables, ctx } = setup({ expenseTransaction: [{ id: 'x', envelopeId: 'env', deletedAt: day(2026, 11, 2), date: CLOSE_NOV }] })
    await closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)
    expect(tables.envelope[0]).toMatchObject({ closedAt: CLOSE_NOV })
  })

  it('rejects a target that already flows into this envelope', async () => {
    const other = envelope({ id: 'other', closedAt: day(2026, 12, 1), carryoverToEnvelopeId: 'env' })
    const { ctx } = setup({ envelope: [envelope(), other] })
    await expect(closeEnvelope(HH, 'env', CLOSE_NOV, 'other', ctx)).rejects.toMatchObject({ statusCode: 400, data: { reason: 'carryover-cycle' } })
  })

  it('rejects an unknown envelope or target, a bad date and a second close', async () => {
    const { ctx } = setup()
    await expect(closeEnvelope(HH, 'missing', CLOSE_NOV, null, ctx)).rejects.toMatchObject({ statusCode: 404 })
    await expect(closeEnvelope(HH, 'env', CLOSE_NOV, 'missing', ctx)).rejects.toMatchObject({ statusCode: 404 })
    await expect(closeEnvelope(HH, 'env', day(2026, 11, 15), null, ctx)).rejects.toMatchObject({ statusCode: 400 })
    const closed = setup({ envelope: [envelope({ closedAt: CLOSE_NOV })] })
    await expect(closeEnvelope(HH, 'env', day(2026, 12, 1), null, closed.ctx)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('writes nothing when it is rejected', async () => {
    const { tables, ctx } = setup({ fixedCostPlan: [fixedCostPlan()] })
    await expect(closeEnvelope(HH, 'env', CLOSE_NOV, null, ctx)).rejects.toBeTruthy()
    expect(tables.envelopeTransfer).toEqual([])
  })
})

describe('setLedgerStart', () => {
  it('stores the opening balance', async () => {
    const { tables, ctx } = setup()
    await expect(setLedgerStart(HH, { openingBalance: 5000 }, ctx)).resolves.toMatchObject({ openingBalance: 5000 })
    expect(tables.household[0]).toMatchObject({ openingBalance: 5000 })
    expect(tables.envelopeTransfer).toEqual([])
  })
})
