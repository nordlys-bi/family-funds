import { describe, expect, it } from 'vitest'
import { computeAccountBalances } from '../account-balance'
import {
  computeEnvelopeBalances,
  computeUnassignedBalance,
  computeUnassignedOpening,
  getEarliestRelevantDate,
  sumEnvelopeBalances,
  type BalanceEnvelope,
  type EnvelopeBalanceInputs,
} from '../envelope-balance'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

function envelope(id: string, overrides: Partial<BalanceEnvelope> = {}): BalanceEnvelope {
  return { id, balanceSince: day(2026, 9, 1), closedAt: null, carryoverToEnvelopeId: null, ...overrides }
}

function inputs(overrides: Partial<EnvelopeBalanceInputs> = {}): EnvelopeBalanceInputs {
  return { expenses: [], incomes: [], transfers: [], ...overrides }
}

const allocation = (to: string, amount: number, date: Date) => ({
  fromEnvelopeId: null, toEnvelopeId: to, amount, date, allocationPeriodStart: date,
})

describe('computeEnvelopeBalances', () => {
  it('sums allocations, incomes, expenses and transfers', () => {
    const balances = computeEnvelopeBalances(
      [envelope('kids'), envelope('holiday')],
      inputs({
        transfers: [
          allocation('kids', 25000, day(2026, 9, 1)),
          allocation('kids', 25000, day(2026, 10, 1)),
          { fromEnvelopeId: 'kids', toEnvelopeId: 'holiday', amount: 5000, date: day(2026, 10, 5) },
        ],
        incomes: [{ envelopeId: 'kids', amount: 3000, date: day(2026, 10, 7) }],
        expenses: [{ envelopeId: 'kids', amount: 31000, date: day(2026, 9, 20) }],
      }),
      day(2026, 10, 31),
    )
    expect(balances.get('kids')).toEqual({
      balance: 50000 + 3000 - 31000 - 5000,
      allocated: 50000,
      income: 3000,
      spent: 31000,
      transferredIn: 50000,
      transferredOut: 5000,
      carriedOver: 0,
    })
    expect(balances.get('holiday')?.balance).toBe(5000)
  })

  it('ignores bookings before balanceSince and after the reference date', () => {
    const balances = computeEnvelopeBalances(
      [envelope('a', { balanceSince: day(2026, 9, 14) })],
      inputs({
        expenses: [
          { envelopeId: 'a', amount: 100, date: day(2026, 9, 13) },
          { envelopeId: 'a', amount: 200, date: day(2026, 9, 14, 8) },
          { envelopeId: 'a', amount: 400, date: day(2026, 10, 2) },
        ],
      }),
      day(2026, 10, 1),
    )
    expect(balances.get('a')?.spent).toBe(200)
  })

  it('carries a closed predecessor’s live balance into its target', () => {
    const balances = computeEnvelopeBalances(
      [
        envelope('weekly', { closedAt: day(2026, 9, 1), carryoverToEnvelopeId: 'monthly', balanceSince: day(2026, 8, 3) }),
        envelope('monthly', { balanceSince: day(2026, 9, 1) }),
      ],
      inputs({
        transfers: [allocation('weekly', 1000, day(2026, 8, 3)), allocation('monthly', 19000, day(2026, 9, 1))],
        // Nachgebuchte Ausgabe vor dem Stichtag korrigiert auch das Ziel
        expenses: [{ envelopeId: 'weekly', amount: 1180, date: day(2026, 8, 30) }],
      }),
      day(2026, 9, 2),
    )
    expect(balances.get('weekly')?.balance).toBe(-180)
    expect(balances.get('monthly')).toMatchObject({ carriedOver: -180, balance: 19000 - 180 })
  })

  it('does not carry over before the target starts', () => {
    const balances = computeEnvelopeBalances(
      [
        envelope('old', { closedAt: day(2026, 9, 1), carryoverToEnvelopeId: 'new', balanceSince: day(2026, 8, 1) }),
        envelope('new', { balanceSince: day(2026, 10, 1) }),
      ],
      inputs({ transfers: [allocation('old', 5000, day(2026, 8, 1))] }),
      day(2026, 9, 15),
    )
    expect(balances.get('new')?.balance).toBe(0)
  })

  it('survives a carryover cycle in broken data', () => {
    const balances = computeEnvelopeBalances(
      [
        envelope('a', { closedAt: day(2026, 9, 1), carryoverToEnvelopeId: 'b' }),
        envelope('b', { closedAt: day(2026, 9, 1), carryoverToEnvelopeId: 'a' }),
      ],
      inputs({ transfers: [allocation('a', 100, day(2026, 9, 1))] }),
      day(2026, 10, 1),
    )
    expect(balances.size).toBe(2)
  })
})

describe('computeUnassignedBalance', () => {
  const ledger = { ledgerSince: day(2026, 11, 2), openingBalance: 80000 }

  it('starts with the opening balance and books unassigned money from ledgerSince', () => {
    const data = inputs({
      incomes: [
        { envelopeId: null, amount: 400000, date: day(2026, 11, 2) },
        { envelopeId: null, amount: 9999, date: day(2026, 11, 1) },
        { envelopeId: 'kids', amount: 3000, date: day(2026, 11, 3) },
      ],
      expenses: [{ envelopeId: null, amount: 95000, date: day(2026, 11, 3) }],
      transfers: [
        allocation('kids', 25000, day(2026, 11, 1)),
        allocation('groceries', 30000, day(2026, 11, 2)),
        { fromEnvelopeId: 'kids', toEnvelopeId: null, amount: 1000, date: day(2026, 11, 4) },
      ],
    })
    // Vor ledgerSince: Einnahme vom 1.11. und Zuteilung vom 1.11. zaehlen nicht
    expect(computeUnassignedBalance(ledger, [], new Map(), data, day(2026, 11, 5))).toBe(80000 + 400000 - 95000 - 30000 + 1000)
  })

  it('adds envelopes closed into "Zu verteilen" from their closing date', () => {
    const closed = envelope('goal', { closedAt: day(2026, 11, 9), carryoverToEnvelopeId: null })
    const balances = computeEnvelopeBalances([closed], inputs({ transfers: [allocation('goal', 50000, day(2026, 9, 1))] }), day(2026, 11, 10))
    expect(computeUnassignedBalance(ledger, [closed], balances, inputs(), day(2026, 11, 8))).toBe(80000)
    expect(computeUnassignedBalance(ledger, [closed], balances, inputs(), day(2026, 11, 10))).toBe(130000)
  })

  it('keeps the invariant: envelopes + unassigned = opening + incomes − expenses', () => {
    const envelopes = [envelope('kids', { balanceSince: ledger.ledgerSince }), envelope('holiday', { balanceSince: ledger.ledgerSince })]
    const data = inputs({
      incomes: [{ envelopeId: null, amount: 300000, date: day(2026, 11, 2) }, { envelopeId: 'kids', amount: 2000, date: day(2026, 11, 6) }],
      expenses: [{ envelopeId: 'kids', amount: 12000, date: day(2026, 11, 5) }, { envelopeId: null, amount: 70000, date: day(2026, 11, 3) }],
      transfers: [
        allocation('kids', 25000, day(2026, 11, 2)),
        { fromEnvelopeId: null, toEnvelopeId: 'holiday', amount: 20000, date: day(2026, 11, 4) },
        { fromEnvelopeId: 'kids', toEnvelopeId: 'holiday', amount: 3000, date: day(2026, 11, 7) },
      ],
    })
    const at = day(2026, 11, 30)
    const balances = computeEnvelopeBalances(envelopes, data, at)
    const total = [...balances.values()].reduce((sum, balance) => sum + balance.balance, 0)
      + computeUnassignedBalance(ledger, envelopes, balances, data, at)
    expect(total).toBe(80000 + 300000 + 2000 - 12000 - 70000)
  })
})

describe('sumEnvelopeBalances', () => {
  const ledgerSince = day(2026, 11, 2)

  it('counts a closed envelope only until its balance has flowed on', () => {
    const goal = envelope('goal', { closedAt: day(2026, 11, 10), carryoverToEnvelopeId: 'holiday' })
    const holiday = envelope('holiday')
    const envelopes = [goal, holiday]
    const data = inputs({ transfers: [allocation('goal', 50000, day(2026, 9, 1)), allocation('holiday', 20000, day(2026, 9, 1))] })
    const total = (at: Date) => sumEnvelopeBalances(envelopes, computeEnvelopeBalances(envelopes, data, at), ledgerSince, at)
    expect(total(day(2026, 11, 9))).toBe(70000)
    expect(total(day(2026, 11, 10))).toBe(70000)
  })

  it('stops counting an envelope closed into "Zu verteilen" once it flowed there', () => {
    const goal = envelope('goal', { closedAt: day(2026, 11, 10), carryoverToEnvelopeId: null })
    const data = inputs({ transfers: [allocation('goal', 50000, day(2026, 9, 1))] })
    const total = (at: Date) => sumEnvelopeBalances([goal], computeEnvelopeBalances([goal], data, at), ledgerSince, at)
    expect(total(day(2026, 11, 9))).toBe(50000)
    expect(total(day(2026, 11, 10))).toBe(0)
  })
})

/*
 * ADR-0006 (issue #188): Mit Konten wird der Startwert von "Zu verteilen"
 * aus den Kontoanfangsbestaenden abgeleitet.
 */
describe('Zu verteilen mit Konten', () => {
  const ledgerSince = day(2026, 12, 1)
  const giro = { id: 'giro', openingBalance: 240000, startDate: ledgerSince }
  const cash = { id: 'cash', openingBalance: 8000, startDate: ledgerSince }
  // Vor dem Stichtag gefuellt: 2.000 € in Umschlaegen, nie aus "Zu verteilen".
  const envelopes = [envelope('kids'), envelope('holiday')]
  const before = [allocation('kids', 120000, day(2026, 10, 1)), allocation('holiday', 80000, day(2026, 11, 1))]

  it('ignores the stored opening balance and derives it: accounts − envelopes at the start', () => {
    const ledger = { ledgerSince, openingBalance: 99999, accounts: [giro, cash] }
    expect(computeUnassignedOpening(ledger, envelopes, inputs({ transfers: before }))).toBe(248000 - 200000)
  })

  it('keeps the stored opening balance without accounts', () => {
    expect(computeUnassignedOpening({ ledgerSince, openingBalance: 5000, accounts: [] }, envelopes, inputs({ transfers: before }))).toBe(5000)
  })

  it('does not count bookings on the start day as already in envelopes', () => {
    const ledger = { ledgerSince, openingBalance: 0, accounts: [giro] }
    const data = inputs({ transfers: [...before, allocation('kids', 25000, ledgerSince)] })
    expect(computeUnassignedOpening(ledger, envelopes, data)).toBe(240000 - 200000)
  })

  it('may start negative when more is assigned than the accounts hold', () => {
    const ledger = { ledgerSince, openingBalance: 0, accounts: [{ ...cash, openingBalance: 50000 }] }
    expect(computeUnassignedOpening(ledger, envelopes, inputs({ transfers: before }))).toBe(-150000)
  })

  it('credits a later account on its start date', () => {
    const piggy = { id: 'piggy', openingBalance: 3500, startDate: day(2027, 2, 1) }
    const ledger = { ledgerSince, openingBalance: 0, accounts: [giro, piggy] }
    const data = inputs({ transfers: before })
    const balances = computeEnvelopeBalances(envelopes, data, day(2027, 2, 1))
    expect(computeUnassignedBalance(ledger, envelopes, balances, data, day(2027, 1, 31))).toBe(40000)
    expect(computeUnassignedBalance(ledger, envelopes, balances, data, day(2027, 2, 1))).toBe(43500)
  })

  it('keeps the invariant: envelopes + unassigned = accounts', () => {
    const piggy = { id: 'piggy', openingBalance: 3500, startDate: day(2026, 12, 20) }
    const accounts = [giro, cash, piggy]
    const ledger = { ledgerSince, openingBalance: 0, accounts }
    const goal = envelope('goal', { closedAt: day(2026, 12, 15), carryoverToEnvelopeId: null })
    const all = [...envelopes, goal]
    const data = inputs({
      incomes: [
        { envelopeId: null, accountId: 'giro', amount: 300000, date: ledgerSince },
        { envelopeId: 'kids', accountId: 'cash', amount: 2000, date: day(2026, 12, 6) },
      ],
      expenses: [
        { envelopeId: 'kids', accountId: 'giro', amount: 12000, date: day(2026, 12, 5) },
        { envelopeId: null, accountId: 'cash', amount: 7000, date: day(2026, 12, 3) },
        { envelopeId: 'holiday', accountId: 'piggy', amount: 500, date: day(2026, 12, 21) },
      ],
      transfers: [
        ...before,
        allocation('goal', 30000, day(2026, 11, 1)),
        allocation('kids', 25000, ledgerSince),
        { fromEnvelopeId: null, toEnvelopeId: 'holiday', amount: 20000, date: day(2026, 12, 4) },
        { fromEnvelopeId: 'kids', toEnvelopeId: 'holiday', amount: 3000, date: day(2026, 12, 7) },
      ],
    })
    for (const at of [ledgerSince, day(2026, 12, 14), day(2026, 12, 15), day(2026, 12, 19), day(2026, 12, 31)]) {
      const balances = computeEnvelopeBalances(all, data, at)
      const left = sumEnvelopeBalances(all, balances, ledgerSince, at) + computeUnassignedBalance(ledger, all, balances, data, at)
      const right = [...computeAccountBalances(accounts, data, at).values()].reduce((sum, value) => sum + value, 0)
      expect(left, at.toDateString()).toBe(right)
    }
  })
})

describe('getEarliestRelevantDate', () => {
  it('returns the earliest of all envelope starts and ledgerSince', () => {
    expect(getEarliestRelevantDate([envelope('a', { balanceSince: day(2026, 9, 1) })], day(2026, 11, 2))).toEqual(day(2026, 9, 1))
    expect(getEarliestRelevantDate([], day(2026, 11, 2))).toEqual(day(2026, 11, 2))
    expect(getEarliestRelevantDate([], null)).toBeNull()
  })
})
