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

describe('plans and the closing date of their envelope', () => {
  const closed = envelope({ allocationSource: 'NONE', allocationAmount: null, closedAt: day(2026, 7, 1) })
  const ended = fixedCostPlan({ endDate: day(2026, 6, 30) })
  const rejected = { statusCode: 409, data: { reason: 'active-plans' } }

  it.each(['fixedCostPlan', 'incomePlan'] as const)('createPlan rejects a %s running past the closing date', async (kind) => {
    const { tables, ctx } = setup({ envelope: [closed] })
    await expect(createPlan(HH, kind, planValues, ctx)).rejects.toMatchObject(rejected)
    expect(tables[kind]).toEqual([])
  })

  it('createPlan allows a plan that ended before the closing date', async () => {
    const { tables, ctx } = setup({ envelope: [closed] })
    await createPlan(HH, 'fixedCostPlan', { ...planValues, startDate: day(2026, 1, 1), endDate: day(2026, 6, 30) }, ctx)
    expect(tables.fixedCostPlan).toHaveLength(1)
  })

  it.each(['fixedCostPlan', 'incomePlan'] as const)('updatePlan rejects extending a %s past the closing date', async (kind) => {
    const { tables, ctx } = setup({ envelope: [closed], [kind]: [ended] })
    await expect(updatePlan(HH, kind, 'plan', { endDate: day(2026, 12, 31) }, ctx)).rejects.toMatchObject(rejected)
    expect(tables[kind][0]!.endDate).toEqual(day(2026, 6, 30))
  })

  it('updatePlan rejects removing the end date', async () => {
    const { ctx } = setup({ envelope: [closed], fixedCostPlan: [ended] })
    await expect(updatePlan(HH, 'fixedCostPlan', 'plan', { endDate: null }, ctx)).rejects.toMatchObject(rejected)
  })

  it('updatePlan rejects moving a running plan to a closed envelope', async () => {
    const { ctx } = setup({ envelope: [envelope(), { ...closed, id: 'closed' }], fixedCostPlan: [fixedCostPlan()] })
    await expect(updatePlan(HH, 'fixedCostPlan', 'plan', { envelopeId: 'closed' }, ctx)).rejects.toMatchObject(rejected)
  })

  it('updatePlan rejects turning a past one-off plan into a recurring one', async () => {
    const once = fixedCostPlan({ frequency: 'ONCE', startDate: day(2026, 6, 1) })
    const { ctx } = setup({ envelope: [closed], fixedCostPlan: [once] })
    await expect(updatePlan(HH, 'fixedCostPlan', 'plan', { frequency: 'MONTHLY' }, ctx)).rejects.toMatchObject(rejected)
  })

  it('updatePlan allows moving an ended plan to a closed envelope', async () => {
    const { tables, ctx } = setup({ envelope: [envelope(), { ...closed, id: 'closed' }], fixedCostPlan: [ended] })
    await updatePlan(HH, 'fixedCostPlan', 'plan', { envelopeId: 'closed' }, ctx)
    expect(tables.fixedCostPlan[0]).toMatchObject({ envelopeId: 'closed' })
  })

  it('updatePlan does not block harmless changes on an existing violation', async () => {
    const { tables, ctx } = setup({ envelope: [closed], fixedCostPlan: [fixedCostPlan()] })
    // Wie das Formular: alle Felder mit, Umschlag und Laufzeit unveraendert.
    await updatePlan(HH, 'fixedCostPlan', 'plan', {
      name: 'Kaltmiete',
      amount: 90000,
      frequency: 'MONTHLY',
      startDate: new Date(2026, 0, 1, 12),
      endDate: null,
      envelopeId: 'env',
    }, ctx)
    expect(tables.fixedCostPlan[0]).toMatchObject({ name: 'Kaltmiete', amount: 90000 })
  })

  it('updatePlan lets an existing violation be fixed by moving the plan', async () => {
    const { tables, ctx } = setup({ envelope: [closed, envelope({ id: 'open' })], fixedCostPlan: [fixedCostPlan()] })
    await updatePlan(HH, 'fixedCostPlan', 'plan', { envelopeId: 'open' }, ctx)
    expect(tables.fixedCostPlan[0]).toMatchObject({ envelopeId: 'open' })
  })

  it('applies to an envelope closing in the future as well', async () => {
    const { ctx } = setup({ envelope: [envelope({ closedAt: day(2027, 1, 1) })] })
    await expect(createPlan(HH, 'fixedCostPlan', planValues, ctx)).rejects.toMatchObject(rejected)
    await createPlan(HH, 'fixedCostPlan', { ...planValues, endDate: day(2026, 12, 31) }, ctx)
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
  it('does not depend on whether someone read before the change', async () => {
    const LATER = day(2026, 11, 15)
    const withRead = setup()
    await ensureAllocations(HH, NOV_15, withRead.db)
    await setLedgerStart(HH, { ledgerSince: LATER }, withRead.ctx)

    const withoutRead = setup()
    await setLedgerStart(HH, { ledgerSince: LATER }, withoutRead.ctx)

    const dates = (tables: InMemoryTables) => tables.envelopeTransfer.map((row) => row.date.getTime())
    expect(dates(withoutRead.tables)).toEqual(dates(withRead.tables))
    // Die begonnene Periode gehoert zum Bestand zum Stichtag.
    expect(withoutRead.tables.envelopeTransfer.at(-1)!.date).toEqual(day(2026, 11, 1))
    expect(withoutRead.tables.household[0]).toMatchObject({ ledgerSince: LATER })
  })

  it('stores the opening balance', async () => {
    const { tables, ctx } = setup()
    await expect(setLedgerStart(HH, { openingBalance: 5000 }, ctx)).resolves.toMatchObject({ openingBalance: 5000 })
    expect(tables.household[0]).toMatchObject({ openingBalance: 5000 })
    expect(tables.envelopeTransfer).toEqual([])
  })
})
