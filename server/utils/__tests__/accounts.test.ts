/*
 * Konten verwalten (ADR-0006, issue #189) gegen den In-Memory-Adapter. Der
 * Massstab ist die Invariante: Σ Umschlaege + Zu verteilen = Σ Konten, nach
 * jeder Aktion und zu jedem Tag.
 */
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryDb, type InMemoryTables } from './helpers/in-memory-db'
import { computeAccountBalances } from '../account-balance'
import { computeEnvelopeBalances, computeUnassignedBalance, sumEnvelopeBalances } from '../envelope-balance'

vi.mock('../prisma', () => ({ prisma: {} }))

const { createAccount, deleteAccount, introduceAccounts, listAccounts, previewIntroduction, setDefaultAccount, setEnvelopeAccounts, updateAccount } = await import('../accounts')

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number) {
  return new Date(year, month - 1, date, 12, 0, 0, 0)
}

const HH = 'h1'
const LEDGER = day(2026, 11, 3)
const NOV_20 = day(2026, 11, 20)

function allocation(periodStart: Date, date: Date) {
  return { householdId: HH, fromEnvelopeId: null, toEnvelopeId: 'kids', amount: 30000, date, allocationPeriodStart: periodStart }
}

/*
 * Stand vor der Einfuehrung: 600 € in "Kinder" (300 € migriert, 300 € im
 * November zugeteilt), 50 € davon ausgegeben; 3.000 € Gehalt ohne Umschlag.
 * "Zu verteilen" zeigt am 19.11.: 100 + 3.000 − 300 = 2.800 €.
 */
function seed(): Partial<InMemoryTables> {
  return {
    household: [{ id: HH, ledgerSince: LEDGER, openingBalance: 10000 }],
    envelope: [{
      id: 'kids', householdId: HH, name: 'Kinder', group: 'RUNNING', frequency: 'MONTHLY',
      balanceSince: day(2026, 10, 1), allocationsSince: null, closedAt: null, carryoverToEnvelopeId: null,
      allocationSource: 'FIXED', allocationAmount: 30000,
    }],
    envelopeTransfer: [allocation(day(2026, 10, 1), day(2026, 10, 1)), allocation(day(2026, 11, 1), LEDGER)],
    incomeTransaction: [{ id: 'salary', householdId: HH, envelopeId: null, accountId: null, amount: 300000, date: day(2026, 11, 5), deletedAt: null }],
    expenseTransaction: [{ id: 'shoes', householdId: HH, envelopeId: 'kids', accountId: null, amount: 5000, date: day(2026, 11, 10), deletedAt: null }],
  }
}

function setup(extra: Partial<InMemoryTables> = {}) {
  const { db, tables } = createInMemoryDb({ ...seed(), ...extra })
  return { db, tables, ctx: { db, today: NOV_20 } }
}

const giro = { name: 'Girokonto', type: 'CHECKING' as const, openingBalance: 400000 }
const cash = { name: 'Geldbeutel', type: 'CASH' as const, openingBalance: 5000 }

/** Beide Seiten der Invariante, gerechnet wie in der Uebersicht. */
function sides(tables: InMemoryTables, at: Date) {
  const active = (rows: InMemoryTables['expenseTransaction']) => rows.filter((row) => row.deletedAt === null)
  const inputs = { expenses: active(tables.expenseTransaction), incomes: active(tables.incomeTransaction), transfers: tables.envelopeTransfer } as never
  const household = tables.household[0]!
  const ledger = { ledgerSince: household.ledgerSince, openingBalance: household.openingBalance, accounts: tables.account as never }
  const balances = computeEnvelopeBalances(tables.envelope as never, inputs, at)
  const unassigned = computeUnassignedBalance(ledger, tables.envelope as never, balances, inputs, at)
  const accounts = [...computeAccountBalances(tables.account as never, inputs, at).values()].reduce((sum, value) => sum + value, 0)
  return { envelopes: sumEnvelopeBalances(tables.envelope as never, balances, household.ledgerSince, at), unassigned, accounts }
}

describe('previewIntroduction', () => {
  it('shows "Zu verteilen" and the envelopes at the end of the day before', async () => {
    const { ctx } = setup()
    await expect(previewIntroduction(HH, NOV_20, ctx)).resolves.toMatchObject({
      ledgerSince: LEDGER,
      envelopesBefore: 55000,
      unassignedBefore: 280000,
      bookingsWithoutAccount: 0,
    })
  })

  it('counts active bookings without an account from the day on', async () => {
    const { ctx } = setup({
      expenseTransaction: [
        { id: 'a', householdId: HH, envelopeId: null, accountId: null, amount: 100, date: day(2026, 11, 20), deletedAt: null },
        { id: 'b', householdId: HH, envelopeId: null, accountId: null, amount: 100, date: day(2026, 11, 20), deletedAt: day(2026, 11, 20) },
      ],
    })
    await expect(previewIntroduction(HH, NOV_20, ctx)).resolves.toMatchObject({ bookingsWithoutAccount: 1 })
  })
})

describe('introduceAccounts', () => {
  it('starts all accounts on the new ledger start and derives "Zu verteilen"', async () => {
    const { tables, ctx } = setup()

    await introduceAccounts(HH, NOV_20, [giro, cash], null, ctx)

    expect(tables.household[0]).toMatchObject({ ledgerSince: NOV_20 })
    expect(tables.account).toEqual([
      expect.objectContaining({ householdId: HH, name: 'Girokonto', openingBalance: 400000, startDate: NOV_20 }),
      expect.objectContaining({ householdId: HH, name: 'Geldbeutel', openingBalance: 5000, startDate: NOV_20 }),
    ])
    // 4.050 € auf den Konten, 550 € in Umschlaegen: 3.500 € frei statt 2.800 €.
    expect(sides(tables, NOV_20)).toEqual({ envelopes: 55000, unassigned: 350000, accounts: 405000 })
  })

  it('keeps the invariant with bookings after the introduction', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, NOV_20, [giro, cash], null, ctx)
    const [giroId, cashId] = tables.account.map((row) => row.id)
    tables.expenseTransaction.push(
      { id: 'x1', householdId: HH, envelopeId: 'kids', accountId: cashId, amount: 2000, date: day(2026, 11, 22), deletedAt: null },
      { id: 'x2', householdId: HH, envelopeId: null, accountId: giroId, amount: 70000, date: day(2026, 11, 25), deletedAt: null },
    )
    tables.incomeTransaction.push({ id: 'i1', householdId: HH, envelopeId: null, accountId: giroId, amount: 1500, date: day(2026, 11, 26), deletedAt: null })

    for (const at of [NOV_20, day(2026, 11, 22), day(2026, 11, 30)]) {
      const { envelopes, unassigned, accounts } = sides(tables, at)
      expect(envelopes + unassigned, at.toDateString()).toBe(accounts)
    }
  })

  it('books due allocations before moving the ledger start', async () => {
    const { tables, ctx } = setup({ envelopeTransfer: [allocation(day(2026, 10, 1), day(2026, 10, 1))] })

    await introduceAccounts(HH, NOV_20, [giro], null, ctx)

    // Gebucht mit dem alten Stichtag, nicht auf den 20.11. verschoben.
    expect(tables.envelopeTransfer.at(-1)).toMatchObject({ allocationPeriodStart: day(2026, 11, 1), date: LEDGER })
  })

  it('rejects bookings without an account from the day on, unless they get one', async () => {
    const late = { id: 'late', householdId: HH, envelopeId: null, accountId: null, amount: 1200, date: NOV_20, deletedAt: null }
    const rejected = setup({ expenseTransaction: [late] })
    await expect(introduceAccounts(HH, NOV_20, [giro, cash], null, rejected.ctx))
      .rejects.toMatchObject({ statusCode: 409, data: { reason: 'bookings-without-account', count: 1 } })
    expect(rejected.tables.account).toEqual([])
    expect(rejected.tables.household[0]).toMatchObject({ ledgerSince: LEDGER })

    const assigned = setup({ expenseTransaction: [late] })
    await introduceAccounts(HH, NOV_20, [giro, cash], 1, assigned.ctx)
    expect(assigned.tables.expenseTransaction[0]).toMatchObject({ accountId: assigned.tables.account[1]!.id })
    const { envelopes, unassigned, accounts } = sides(assigned.tables, NOV_20)
    expect(envelopes + unassigned).toBe(accounts)
  })

  it.each([
    ['without accounts', [], null, NOV_20, 400],
    ['in the future', [giro], null, day(2026, 11, 21), 400],
    ['before the current ledger start', [giro], null, day(2026, 11, 2), 400],
    ['with an unknown account for existing bookings', [giro], 3, NOV_20, 400],
  ] as const)('rejects an introduction %s', async (_name, accounts, existing, date, statusCode) => {
    const { tables, ctx } = setup()
    await expect(introduceAccounts(HH, date, [...accounts], existing, ctx)).rejects.toMatchObject({ statusCode })
    expect(tables.account).toEqual([])
  })

  it('happens only once', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, NOV_20, [giro], null, ctx)
    await expect(introduceAccounts(HH, NOV_20, [cash], null, ctx)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'introduced' } })
    expect(tables.account).toHaveLength(1)
  })
})

describe('createAccount', () => {
  const piggy = { name: 'Sparschwein', type: 'CASH' as const, openingBalance: 3500 }

  it('needs the introduction first', async () => {
    const { tables, ctx } = setup()
    await expect(createAccount(HH, { ...piggy, startDate: NOV_20 }, ctx)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'not-introduced' } })
    expect(tables.account).toEqual([])
  })

  it('credits "Zu verteilen" with its opening balance from its start', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, day(2026, 11, 10), [giro], 0, { ...ctx, today: day(2026, 11, 10) })
    const before = sides(tables, day(2026, 11, 20))

    await createAccount(HH, { ...piggy, startDate: NOV_20 }, ctx)

    expect(sides(tables, day(2026, 11, 19)).unassigned).toBe(before.unassigned)
    const after = sides(tables, NOV_20)
    expect(after.unassigned).toBe(before.unassigned + 3500)
    expect(after.envelopes + after.unassigned).toBe(after.accounts)
  })

  it('does not start before the ledger start or in the future', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, day(2026, 11, 10), [giro], 0, ctx)
    await expect(createAccount(HH, { ...piggy, startDate: day(2026, 11, 9) }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createAccount(HH, { ...piggy, startDate: day(2026, 11, 21) }, ctx)).rejects.toMatchObject({ statusCode: 400 })
    expect(tables.account).toHaveLength(1)
  })
})

describe('updateAccount', () => {
  async function introduced() {
    const context = setup()
    await introduceAccounts(HH, day(2026, 11, 10), [giro, cash], 0, context.ctx)
    return { ...context, giroId: context.tables.account[0]!.id, cashId: context.tables.account[1]!.id }
  }

  it('changes name, type and opening balance', async () => {
    const { tables, ctx, cashId } = await introduced()
    await updateAccount(HH, cashId, { name: 'Bargeld', type: 'CASH', openingBalance: 6000 }, ctx)
    expect(tables.account[1]).toMatchObject({ name: 'Bargeld', openingBalance: 6000 })
  })

  it('closes only without bookings from the closing date on', async () => {
    const { tables, ctx, giroId } = await introduced()
    // Nicht am Starttag; die Ausgabe vom 10.11. hat bei der Einfuehrung das
    // Girokonto bekommen und liegt vor dem 11.11.
    await expect(updateAccount(HH, giroId, { closedAt: day(2026, 11, 10) }, ctx)).rejects.toMatchObject({ statusCode: 400, data: { reason: 'close-before-start' } })
    await expect(updateAccount(HH, giroId, { closedAt: day(2026, 11, 11) }, ctx)).resolves.toBeTruthy()
    expect(tables.account[0]).toMatchObject({ closedAt: day(2026, 11, 11) })

    tables.expenseTransaction.push({ id: 'y', householdId: HH, envelopeId: null, accountId: giroId, amount: 1, date: day(2026, 11, 15), deletedAt: null })
    await expect(updateAccount(HH, giroId, { closedAt: day(2026, 11, 12) }, ctx)).rejects.toMatchObject({ statusCode: 409 })
    await updateAccount(HH, giroId, { closedAt: null }, ctx)
    expect(tables.account[0]).toMatchObject({ closedAt: null })
  })

  it('knows no account of another household', async () => {
    const { ctx } = await introduced()
    await expect(updateAccount('h2', 'account-1', { name: 'x' }, ctx)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteAccount', () => {
  it('deletes an account without bookings, but never the last one', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, NOV_20, [giro, cash], null, ctx)
    const [giroId, cashId] = tables.account.map((row) => row.id)

    await deleteAccount(HH, cashId, ctx)
    expect(tables.account.map((row) => row.id)).toEqual([giroId])
    await expect(deleteAccount(HH, giroId, ctx)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'last-account' } })
  })

  it('keeps an account with bookings, even deleted ones', async () => {
    const { tables, ctx } = setup()
    await introduceAccounts(HH, NOV_20, [giro, cash], null, ctx)
    const cashId = tables.account[1]!.id
    tables.expenseTransaction.push({ id: 'z', householdId: HH, envelopeId: null, accountId: cashId, amount: 1, date: NOV_20, deletedAt: NOV_20 })

    await expect(deleteAccount(HH, cashId, ctx)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'has-bookings' } })
    expect(tables.account).toHaveLength(2)
  })
})

describe('listAccounts', () => {
  it('returns balances from active bookings and marks accounts with bookings', async () => {
    const { tables, ctx } = setup()
    expect(await listAccounts(HH, ctx)).toEqual([])

    await introduceAccounts(HH, day(2026, 11, 10), [giro, cash], 0, ctx)
    const cashId = tables.account[1]!.id
    tables.expenseTransaction.push({ id: 'gone', householdId: HH, envelopeId: null, accountId: cashId, amount: 900, date: NOV_20, deletedAt: NOV_20 })

    const accounts = await listAccounts(HH, ctx)
    expect(accounts.map(({ name, balance, hasBookings }) => ({ name, balance, hasBookings }))).toEqual([
      { name: 'Girokonto', balance: 400000 - 5000, hasBookings: true },
      { name: 'Geldbeutel', balance: 5000, hasBookings: true },
    ])
  })
})

/*
 * Bindung und Standardkonto (issue #190): nur Eingabefilter, darum genuegt
 * es zu pruefen, was gespeichert wird.
 */
describe('setEnvelopeAccounts', () => {
  const accounts = [
    { id: 'giro', householdId: HH, name: 'Girokonto', startDate: LEDGER, closedAt: null },
    { id: 'cash', householdId: HH, name: 'Geldbeutel', startDate: LEDGER, closedAt: null },
  ]

  it('replaces the binding and makes the first account primary by default', async () => {
    const { tables, ctx } = setup({ account: accounts, envelopeAccount: [{ envelopeId: 'kids', accountId: 'cash' }] })

    await expect(setEnvelopeAccounts(HH, 'kids', ['giro', 'cash'], null, ctx)).resolves.toEqual({ accountIds: ['giro', 'cash'], primaryAccountId: 'giro' })
    expect(tables.envelopeAccount).toEqual([{ id: expect.any(String), envelopeId: 'kids', accountId: 'giro' }, { id: expect.any(String), envelopeId: 'kids', accountId: 'cash' }])
    expect(tables.envelope[0]).toMatchObject({ primaryAccountId: 'giro' })
  })

  it('keeps the chosen primary account and clears everything with an empty list', async () => {
    const { tables, ctx } = setup({ account: accounts })

    await setEnvelopeAccounts(HH, 'kids', ['giro', 'cash'], 'cash', ctx)
    expect(tables.envelope[0]).toMatchObject({ primaryAccountId: 'cash' })

    await setEnvelopeAccounts(HH, 'kids', [], null, ctx)
    expect(tables.envelopeAccount).toEqual([])
    expect(tables.envelope[0]).toMatchObject({ primaryAccountId: null })
  })

  it('rejects a primary account outside the binding and foreign accounts', async () => {
    const { tables, ctx } = setup({ account: [...accounts, { id: 'other', householdId: 'h2', name: 'Fremd', startDate: LEDGER, closedAt: null }] })

    await expect(setEnvelopeAccounts(HH, 'kids', ['giro'], 'cash', ctx)).rejects.toMatchObject({ statusCode: 400, data: { reason: 'primary-not-bound' } })
    await expect(setEnvelopeAccounts(HH, 'kids', ['other'], null, ctx)).rejects.toMatchObject({ statusCode: 404 })
    await expect(setEnvelopeAccounts(HH, 'nope', ['giro'], null, ctx)).rejects.toMatchObject({ statusCode: 404 })
    expect(tables.envelopeAccount).toEqual([])
  })
})

describe('setDefaultAccount', () => {
  const members = [
    { id: 'm1', householdId: HH, userId: 'jan', defaultAccountId: null },
    { id: 'm2', householdId: HH, userId: 'sarah', defaultAccountId: null },
  ]
  const accounts = [
    { id: 'cash', householdId: HH, name: 'Geldbeutel', startDate: LEDGER, closedAt: null },
    { id: 'old', householdId: HH, name: 'Altes Konto', startDate: LEDGER, closedAt: day(2026, 11, 15) },
  ]

  it('sets only the own default account and clears it with null', async () => {
    const { tables, ctx } = setup({ account: accounts, householdMember: members })

    await setDefaultAccount(HH, 'sarah', 'cash', ctx)
    expect(tables.householdMember.map((member) => member.defaultAccountId)).toEqual([null, 'cash'])

    await setDefaultAccount(HH, 'sarah', null, ctx)
    expect(tables.householdMember.map((member) => member.defaultAccountId)).toEqual([null, null])
  })

  it('rejects closed and unknown accounts', async () => {
    const { ctx } = setup({ account: accounts, householdMember: members })

    await expect(setDefaultAccount(HH, 'sarah', 'old', ctx)).rejects.toMatchObject({ statusCode: 400, data: { reason: 'closed' } })
    await expect(setDefaultAccount(HH, 'sarah', 'nope', ctx)).rejects.toMatchObject({ statusCode: 404 })
  })
})
