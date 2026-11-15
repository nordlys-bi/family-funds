/*
 * Tests fuer die Schreibwege von Ausgaben und Einnahmen (issue #181) gegen den
 * In-Memory-Adapter: Sie pruefen, was danach in der Tabelle steht, nicht
 * welche Prisma-Aufrufe in welcher Reihenfolge kamen. Jede Regel laeuft fuer
 * beide Arten, weil genau das vorher kopiert war.
 */
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryDb, type InMemoryTables } from './helpers/in-memory-db'
import type { TransactionKind } from '../transactions'

vi.mock('../prisma', () => ({ prisma: {} }))

const { assertTransactionKind, createTransaction, deleteTransaction, restoreTransaction, transactionKinds, updateTransaction } = await import('../transactions')

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number) {
  return new Date(year, month - 1, date, 12, 0, 0, 0)
}

const HH = 'h1'
const OTHER_HH = 'h2'
const kinds: TransactionKind[] = ['expense', 'income']
const tableOf = { expense: 'expenseTransaction', income: 'incomeTransaction' } as const
const planTableOf = { expense: 'fixedCostPlan', income: 'incomePlan' } as const
const planFieldOf = { expense: 'fixedCostPlanId', income: 'incomePlanId' } as const

function envelope(overrides: Record<string, unknown> = {}) {
  return { id: 'env', householdId: HH, name: 'Kinder', balanceSince: day(2026, 10, 1), closedAt: null, ...overrides }
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx',
    householdId: HH,
    userId: 'u1',
    amount: 5000,
    description: 'Schuhe',
    date: day(2026, 11, 3),
    envelopeId: 'env',
    deletedAt: null,
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown> = {}) {
  return { id: 'plan', householdId: HH, name: 'Miete', envelopeId: 'env-plan', ...overrides }
}

const values = { amount: 5000, date: day(2026, 11, 3), description: 'Schuhe', envelopeId: 'env', planId: null }

function setup(kind: TransactionKind, seed: Partial<InMemoryTables> = {}) {
  const { db, tables } = createInMemoryDb({
    envelope: [envelope(), envelope({ id: 'env-plan', name: 'Wohnen' })],
    ...seed,
  })
  return { tables, rowsOf: () => tables[tableOf[kind]], ctx: { db, now: day(2026, 11, 15) } }
}

describe.each(kinds)('createTransaction (%s)', (kind) => {
  it('legt die Buchung mit Umschlag und Nutzer an', async () => {
    const { rowsOf, ctx } = setup(kind)

    await createTransaction(HH, 'u1', kind, values, ctx)

    expect(rowsOf()).toEqual([
      expect.objectContaining({ householdId: HH, userId: 'u1', amount: 5000, description: 'Schuhe', envelopeId: 'env', [planFieldOf[kind]]: null }),
    ])
  })

  it.each([['einen anderen Umschlag', 'env'], ['"Zu verteilen"', null]])('erbt den Umschlag des Plans, auch wenn der Body %s nennt', async (_name, envelopeId) => {
    const { rowsOf, ctx } = setup(kind, { [planTableOf[kind]]: [plan()] })

    await createTransaction(HH, 'u1', kind, { ...values, envelopeId, planId: 'plan' }, ctx)

    expect(rowsOf()[0]).toMatchObject({ envelopeId: 'env-plan', [planFieldOf[kind]]: 'plan' })
  })

  it('nimmt den Umschlag aus dem Body, wenn der Plan keinen hat', async () => {
    const { rowsOf, ctx } = setup(kind, { [planTableOf[kind]]: [plan({ envelopeId: null })] })

    await createTransaction(HH, 'u1', kind, { ...values, planId: 'plan' }, ctx)

    expect(rowsOf()[0]).toMatchObject({ envelopeId: 'env', [planFieldOf[kind]]: 'plan' })
  })

  it('kennt keinen Plan eines anderen Haushalts', async () => {
    const { rowsOf, ctx } = setup(kind, { [planTableOf[kind]]: [plan({ householdId: OTHER_HH })] })

    await expect(createTransaction(HH, 'u1', kind, { ...values, planId: 'plan' }, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()).toEqual([])
  })

  it('kennt keinen Umschlag eines anderen Haushalts', async () => {
    const { rowsOf, ctx } = setup(kind, { envelope: [envelope({ householdId: OTHER_HH })] })

    await expect(createTransaction(HH, 'u1', kind, values, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()).toEqual([])
  })

  it('lehnt eine Buchung vor dem Startpunkt des Umschlags ab', async () => {
    const { rowsOf, ctx } = setup(kind)

    await expect(createTransaction(HH, 'u1', kind, { ...values, date: day(2026, 9, 30) }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(rowsOf()).toEqual([])
  })

  it('lehnt eine Buchung ab dem Stichtag ab, davor geht sie noch', async () => {
    const { rowsOf, ctx } = setup(kind, { envelope: [envelope({ closedAt: day(2026, 11, 5) })] })

    await expect(createTransaction(HH, 'u1', kind, { ...values, date: day(2026, 11, 5) }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    await createTransaction(HH, 'u1', kind, { ...values, date: day(2026, 11, 4) }, ctx)

    expect(rowsOf()).toHaveLength(1)
  })

  it('erlaubt eine Buchung ohne Umschlag auch vor allen Startpunkten (Nacherfassen)', async () => {
    const { rowsOf, ctx } = setup(kind)

    await createTransaction(HH, 'u1', kind, { ...values, envelopeId: null, date: day(2025, 3, 1) }, ctx)

    expect(rowsOf()[0]).toMatchObject({ envelopeId: null })
  })
})

describe.each(kinds)('updateTransaction (%s)', (kind) => {
  it('aendert nur, was angegeben ist', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking()] })

    await updateTransaction(HH, kind, 'tx', { amount: 7000 }, ctx)

    expect(rowsOf()[0]).toMatchObject({ amount: 7000, description: 'Schuhe', envelopeId: 'env', date: day(2026, 11, 3) })
  })

  it('setzt den Umschlag auf "Zu verteilen"', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking()] })

    await updateTransaction(HH, kind, 'tx', { envelopeId: null }, ctx)

    expect(rowsOf()[0]).toMatchObject({ envelopeId: null })
  })

  it('aendert eine geloeschte Buchung nicht', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ deletedAt: day(2026, 11, 10) })] })

    await expect(updateTransaction(HH, kind, 'tx', { amount: 7000 }, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()[0]).toMatchObject({ amount: 5000 })
  })

  it('aendert keine Buchung eines anderen Haushalts', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ householdId: OTHER_HH })] })

    await expect(updateTransaction(HH, kind, 'tx', { amount: 7000 }, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()[0]).toMatchObject({ amount: 5000 })
  })

  it('laesst Altbestand vor dem Startpunkt korrigieren, solange Umschlag und Tag bleiben', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ date: day(2026, 9, 20) })] })

    // Das Formular schickt das Datum immer mit, hier mit anderer Uhrzeit.
    await updateTransaction(HH, kind, 'tx', { amount: 4500, date: new Date(2026, 8, 20, 8), envelopeId: 'env' }, ctx)

    expect(rowsOf()[0]).toMatchObject({ amount: 4500 })
  })

  it('prueft den bisherigen Umschlag, wenn sich nur das Datum aendert', async () => {
    const { rowsOf, ctx } = setup(kind, {
      envelope: [envelope({ closedAt: day(2026, 11, 20) })],
      [tableOf[kind]]: [booking()],
    })

    await expect(updateTransaction(HH, kind, 'tx', { date: day(2026, 11, 25) }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(rowsOf()[0]).toMatchObject({ date: day(2026, 11, 3) })
  })

  it('prueft das bisherige Datum, wenn sich nur der Umschlag aendert', async () => {
    const { rowsOf, ctx } = setup(kind, {
      envelope: [envelope({ id: 'env-new', balanceSince: day(2026, 11, 10) }), envelope()],
      [tableOf[kind]]: [booking()],
    })

    await expect(updateTransaction(HH, kind, 'tx', { envelopeId: 'env-new' }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(rowsOf()[0]).toMatchObject({ envelopeId: 'env' })
  })
})

describe.each(kinds)('deleteTransaction (%s)', (kind) => {
  it('loescht weich: Die Zeile bleibt mit deletedAt', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking()] })

    await deleteTransaction(HH, kind, 'tx', ctx)

    expect(rowsOf()).toEqual([expect.objectContaining({ id: 'tx', deletedAt: ctx.now })])
  })

  it('kennt eine schon geloeschte Buchung nicht mehr', async () => {
    const deletedAt = day(2026, 11, 10)
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ deletedAt })] })

    await expect(deleteTransaction(HH, kind, 'tx', ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()[0]).toMatchObject({ deletedAt })
  })

  it('loescht keine Buchung eines anderen Haushalts', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ householdId: OTHER_HH })] })

    await expect(deleteTransaction(HH, kind, 'tx', ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(rowsOf()[0]).toMatchObject({ deletedAt: null })
  })
})

describe.each(kinds)('restoreTransaction (%s)', (kind) => {
  it('holt eine geloeschte Buchung zurueck', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ deletedAt: day(2026, 11, 10) })] })

    await expect(restoreTransaction(HH, kind, 'tx', ctx)).resolves.toEqual({ alreadyActive: false })
    expect(rowsOf()[0]).toMatchObject({ deletedAt: null })
  })

  it('ist idempotent', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking()] })

    await expect(restoreTransaction(HH, kind, 'tx', ctx)).resolves.toEqual({ alreadyActive: true })
    expect(rowsOf()[0]).toMatchObject({ deletedAt: null })
  })

  it('kennt keine Buchung eines anderen Haushalts', async () => {
    const { ctx } = setup(kind, { [tableOf[kind]]: [booking({ householdId: OTHER_HH, deletedAt: day(2026, 11, 10) })] })

    await expect(restoreTransaction(HH, kind, 'tx', ctx)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('holt keine Buchung ab dem Stichtag ihres Umschlags zurueck', async () => {
    const deletedAt = day(2026, 11, 10)
    const { rowsOf, ctx } = setup(kind, {
      envelope: [envelope({ closedAt: day(2026, 11, 1) })],
      [tableOf[kind]]: [booking({ deletedAt })],
    })

    await expect(restoreTransaction(HH, kind, 'tx', ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(rowsOf()[0]).toMatchObject({ deletedAt })
  })

  it('holt Altbestand vor dem Startpunkt zurueck', async () => {
    const { rowsOf, ctx } = setup(kind, { [tableOf[kind]]: [booking({ date: day(2026, 9, 20), deletedAt: day(2026, 11, 10) })] })

    await restoreTransaction(HH, kind, 'tx', ctx)

    expect(rowsOf()[0]).toMatchObject({ deletedAt: null })
  })
})

describe('transactionKinds', () => {
  it('exposes expense and income as the only kinds', () => {
    expect(transactionKinds).toEqual(['expense', 'income'])
  })
})

describe('assertTransactionKind', () => {
  it('accepts valid kinds unchanged', () => {
    expect(assertTransactionKind('expense')).toBe('expense')
    expect(assertTransactionKind('income')).toBe('income')
  })

  it('throws 400 for unknown strings', () => {
    expect(() => assertTransactionKind('transfer')).toThrowError(/Invalid transaction kind/)
  })

  it('throws 400 for non-string values', () => {
    expect(() => assertTransactionKind(null)).toThrowError(/Invalid transaction kind/)
    expect(() => assertTransactionKind(undefined)).toThrowError(/Invalid transaction kind/)
    expect(() => assertTransactionKind(0)).toThrowError(/Invalid transaction kind/)
  })
})
