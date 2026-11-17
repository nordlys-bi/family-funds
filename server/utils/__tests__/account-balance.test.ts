import { describe, expect, it } from 'vitest'
import { computeAccountBalances, type BalanceAccount } from '../account-balance'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

function account(id: string, overrides: Partial<BalanceAccount> = {}): BalanceAccount {
  return { id, openingBalance: 0, startDate: day(2026, 12, 1), ...overrides }
}

describe('computeAccountBalances', () => {
  it('starts with the opening balance and books incomes and expenses of the account', () => {
    const balances = computeAccountBalances(
      [account('giro', { openingBalance: 240000 }), account('cash', { openingBalance: 8000 })],
      {
        incomes: [{ accountId: 'giro', amount: 300000, date: day(2026, 12, 1, 8) }],
        expenses: [
          { accountId: 'giro', amount: 95000, date: day(2026, 12, 3) },
          { accountId: 'cash', amount: 2500, date: day(2026, 12, 4) },
          { accountId: null, amount: 9999, date: day(2026, 12, 4) },
        ],
      },
      day(2026, 12, 31),
    )
    expect(balances).toEqual(new Map([['giro', 240000 + 300000 - 95000], ['cash', 8000 - 2500]]))
  })

  it('is 0 before the start, without the opening balance', () => {
    const balances = computeAccountBalances([account('piggy', { openingBalance: 3500, startDate: day(2027, 2, 1) })], { incomes: [], expenses: [] }, day(2027, 1, 31))
    expect(balances.get('piggy')).toBe(0)
  })

  it('ignores bookings before the start and after the reference date', () => {
    const balances = computeAccountBalances(
      [account('giro', { openingBalance: 1000 })],
      {
        incomes: [],
        expenses: [
          { accountId: 'giro', amount: 100, date: day(2026, 11, 30) },
          { accountId: 'giro', amount: 200, date: day(2026, 12, 5) },
          { accountId: 'giro', amount: 400, date: day(2026, 12, 6) },
        ],
      },
      day(2026, 12, 5, 23),
    )
    expect(balances.get('giro')).toBe(800)
  })

  it('ignores bookings on unknown accounts', () => {
    const balances = computeAccountBalances([account('giro')], { incomes: [{ accountId: 'other', amount: 500, date: day(2026, 12, 2) }], expenses: [] }, day(2026, 12, 31))
    expect(balances.get('giro')).toBe(0)
  })
})
