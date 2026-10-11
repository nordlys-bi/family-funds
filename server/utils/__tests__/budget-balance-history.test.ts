import { describe, expect, it } from 'vitest'
import type { Frequency } from '@prisma/client'
import { computeBudgetBalances, listAllocations, type BalanceBudget } from '../budget-balance'
import {
  computeBalanceTrends,
  computeBudgetBalanceHistory,
  computeChainBalances,
  getBudgetChain,
  getDefaultHistoryRange,
} from '../budget-balance-history'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

function makeBudget(overrides: Partial<BalanceBudget> & { frequency: Frequency; balanceSince: Date }): BalanceBudget {
  return {
    id: overrides.id ?? 'b1',
    frequency: overrides.frequency,
    balanceSince: overrides.balanceSince,
    closedAt: overrides.closedAt ?? null,
    carryoverToBudgetId: overrides.carryoverToBudgetId ?? null,
    versions: overrides.versions ?? [],
  }
}

const monthly = makeBudget({
  id: 'm',
  frequency: 'MONTHLY',
  balanceSince: day(2026, 9, 1),
  versions: [
    { amount: 10000, validFrom: day(2026, 9, 1) },
    { amount: 15000, validFrom: day(2026, 10, 1) },
  ],
})

describe('listAllocations', () => {
  it('lists one allocation per period with its allocating version', () => {
    const allocations = listAllocations(monthly, day(2026, 10, 11))
    expect(allocations.map((allocation) => [allocation.date.getMonth() + 1, allocation.amount])).toEqual([
      [9, 10000],
      [10, 15000],
    ])
    expect(allocations[1]!.version).toBe(monthly.versions[1])
  })
})

describe('computeBudgetBalanceHistory', () => {
  it('starts with the opening balance and adds one point per event day', () => {
    const expenses = [
      { budgetId: 'm', amount: 3000, date: day(2026, 9, 5, 9) },
      { budgetId: 'm', amount: 2000, date: day(2026, 9, 5, 18) },
      { budgetId: 'm', amount: 1000, date: day(2026, 9, 20) },
      { budgetId: 'other', amount: 9999, date: day(2026, 9, 21) },
    ]
    const transfers = [{ sourceBudgetId: 'm', amount: 500, date: day(2026, 9, 25) }]

    const history = computeBudgetBalanceHistory([monthly], expenses, transfers, 'm', day(2026, 9, 1), day(2026, 10, 11))

    expect(history.from).toBe('2026-09-01')
    expect(history.to).toBe('2026-10-11')
    expect(history.points).toEqual([
      // Startsaldo = Stand am Vortag, die Zuteilung am 1.9. ist die erste Stufe
      { date: '2026-09-01', balance: 0 },
      { date: '2026-09-01', balance: 10000 },
      { date: '2026-09-05', balance: 5000 },
      { date: '2026-09-20', balance: 4000 },
      { date: '2026-09-25', balance: 3500 },
      { date: '2026-10-01', balance: 18500 },
      { date: '2026-10-11', balance: 18500 },
    ])
    expect(history.events).toEqual([
      { type: 'transfer', date: '2026-09-25', amount: 500, budgetId: 'm' },
      { type: 'version', date: '2026-10-01', amount: 15000, budgetId: 'm' },
    ])
  })

  it('lists every movement with its signed effect as entries', () => {
    const expenses = [{ budgetId: 'm', amount: 3000, date: day(2026, 9, 5), id: 'e1', description: 'Rewe' }]
    const transfers = [{
      sourceBudgetId: 'm', amount: 500, date: day(2026, 9, 5), id: 't1', note: null, savingsGoal: { id: 'g1', name: 'Urlaub' },
    }]
    const history = computeBudgetBalanceHistory([monthly], expenses, transfers, 'm', day(2026, 9, 1), day(2026, 10, 11))
    expect(history.entries).toEqual([
      { type: 'allocation', date: '2026-09-01', amount: 10000, budgetId: 'm' },
      { type: 'expense', date: '2026-09-05', amount: -3000, budgetId: 'm', id: 'e1', text: 'Rewe' },
      { type: 'transfer', date: '2026-09-05', amount: -500, budgetId: 'm', id: 't1', text: null, savingsGoal: { id: 'g1', name: 'Urlaub' } },
      { type: 'allocation', date: '2026-10-01', amount: 15000, budgetId: 'm' },
    ])
    // Summe der Bewegungen = Endsaldo minus Startsaldo
    const delta = history.entries.reduce((sum, entry) => sum + entry.amount, 0)
    expect(delta).toBe(history.points.at(-1)!.balance - history.points[0]!.balance)
  })

  it('ends at the same value as computeBudgetBalances', () => {
    const expenses = [{ budgetId: 'm', amount: 4200, date: day(2026, 10, 3) }]
    const history = computeBudgetBalanceHistory([monthly], expenses, [], 'm', day(2026, 9, 15), day(2026, 10, 11))
    const balance = computeBudgetBalances([monthly], expenses, [], day(2026, 10, 11)).get('m')!.balance
    expect(history.points.at(-1)!.balance).toBe(balance)
    // Startsaldo am 15.9. enthaelt die Septemberzuteilung
    expect(history.points[0]).toEqual({ date: '2026-09-15', balance: 10000 })
  })

  it('ignores bookings outside the range and before balanceSince', () => {
    const expenses = [
      { budgetId: 'm', amount: 100, date: day(2026, 8, 30) },
      { budgetId: 'm', amount: 100, date: day(2026, 9, 10) },
    ]
    const history = computeBudgetBalanceHistory([monthly], expenses, [], 'm', day(2026, 9, 15), day(2026, 9, 30))
    expect(history.points).toEqual([
      { date: '2026-09-15', balance: 9900 },
      { date: '2026-09-30', balance: 9900 },
    ])
  })

  it('clamps `from` to the balance start of the budget', () => {
    const history = computeBudgetBalanceHistory([monthly], [], [], 'm', day(2026, 7, 11), day(2026, 9, 10))
    expect(history.from).toBe('2026-09-01')
    expect(history.points).toEqual([
      { date: '2026-09-01', balance: 0 },
      { date: '2026-09-01', balance: 10000 },
      { date: '2026-09-10', balance: 10000 },
    ])
  })

  it('does not mark a version change when the amount stays the same', () => {
    const budget = makeBudget({
      id: 'w',
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      versions: [
        { amount: 100, validFrom: day(2026, 9, 14) },
        { amount: 100, validFrom: day(2026, 9, 28) },
      ],
    })
    const history = computeBudgetBalanceHistory([budget], [], [], 'w', day(2026, 9, 14), day(2026, 10, 11))
    expect(history.events).toEqual([])
    expect(history.points.at(-1)!.balance).toBe(400)
  })

  describe('closed predecessor chain', () => {
    // Woechentlich 14.9.–4.10., dann ins Monatsbudget ab 1.10. geschlossen
    // (Einfliesszeitpunkt = spaeterer von 5.10. und 1.10. = 5.10.).
    const weekly = makeBudget({
      id: 'w',
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      closedAt: day(2026, 10, 5),
      carryoverToBudgetId: 'n',
      versions: [{ amount: 1000, validFrom: day(2026, 9, 14) }],
    })
    const successor = makeBudget({
      id: 'n',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 10, 1),
      versions: [{ amount: 5000, validFrom: day(2026, 10, 1) }],
    })
    const budgets = [weekly, successor]
    const expenses = [
      { budgetId: 'w', amount: 400, date: day(2026, 9, 16) },
      { budgetId: 'n', amount: 700, date: day(2026, 10, 8) },
    ]

    it('includes the predecessor history and does not jump at the carryover', () => {
      const history = computeBudgetBalanceHistory(budgets, expenses, [], 'n', day(2026, 9, 14), day(2026, 10, 11))
      expect(history.points).toEqual([
        { date: '2026-09-14', balance: 0 },
        { date: '2026-09-14', balance: 1000 },
        { date: '2026-09-16', balance: 600 },
        { date: '2026-09-21', balance: 1600 },
        { date: '2026-09-28', balance: 2600 },
        { date: '2026-10-01', balance: 7600 },
        { date: '2026-10-05', balance: 7600 },
        { date: '2026-10-08', balance: 6900 },
        { date: '2026-10-11', balance: 6900 },
      ])
      expect(history.events).toEqual([
        { type: 'carryover', date: '2026-10-05', amount: 2600, budgetId: 'n', fromBudgetId: 'w' },
      ])
      expect(history.points.at(-1)!.balance).toBe(
        computeBudgetBalances(budgets, expenses, [], day(2026, 10, 11)).get('n')!.balance,
      )
    })

    it('resolves chains transitively', () => {
      const first = makeBudget({
        id: 'a',
        frequency: 'WEEKLY',
        balanceSince: day(2026, 9, 1),
        closedAt: day(2026, 9, 14),
        carryoverToBudgetId: 'w',
      })
      expect(getBudgetChain([first, ...budgets], 'n').map((budget) => budget.id)).toEqual(['n', 'w', 'a'])
      expect(getBudgetChain([first, ...budgets], 'w').map((budget) => budget.id)).toEqual(['w', 'a'])
    })

    it('counts a not-yet-flowed-in predecessor in the chain balance', () => {
      const chain = computeChainBalances(budgets, expenses, [], day(2026, 10, 2))
      expect(chain.get('n')).toBe(5000 + 2600)
      expect(chain.get('w')).toBe(2600)
      const after = computeChainBalances(budgets, expenses, [], day(2026, 10, 6))
      expect(after.get('n')).toBe(computeBudgetBalances(budgets, expenses, [], day(2026, 10, 6)).get('n')!.balance)
    })
  })

  it('survives a carryover cycle in corrupt data', () => {
    const left = makeBudget({ id: 'l', frequency: 'MONTHLY', balanceSince: day(2026, 9, 1), closedAt: day(2026, 10, 1), carryoverToBudgetId: 'r' })
    const right = makeBudget({ id: 'r', frequency: 'MONTHLY', balanceSince: day(2026, 9, 1), closedAt: day(2026, 10, 1), carryoverToBudgetId: 'l' })
    const history = computeBudgetBalanceHistory([left, right], [], [], 'l', day(2026, 9, 1), day(2026, 10, 11))
    expect(history.points.length).toBeGreaterThan(0)
  })
})

describe('computeBalanceTrends', () => {
  it('samples every budget on a fixed grid and always includes `to`', () => {
    const expenses = [{ budgetId: 'm', amount: 1000, date: day(2026, 9, 10) }]
    const trends = computeBalanceTrends([monthly], expenses, [], ['m'], day(2026, 9, 1), day(2026, 9, 20), 7)
    expect(trends.get('m')).toEqual([
      { date: '2026-09-01', balance: 10000 },
      { date: '2026-09-08', balance: 10000 },
      { date: '2026-09-15', balance: 9000 },
      { date: '2026-09-20', balance: 9000 },
    ])
  })
})

describe('computeBalanceTrends — balance start', () => {
  it('skips grid points before balanceSince and starts on the start day', () => {
    const trends = computeBalanceTrends([monthly], [], [], ['m'], day(2026, 8, 1), day(2026, 9, 20), 7)
    expect(trends.get('m')).toEqual([
      { date: '2026-09-01', balance: 10000 },
      { date: '2026-09-05', balance: 10000 },
      { date: '2026-09-12', balance: 10000 },
      { date: '2026-09-19', balance: 10000 },
      { date: '2026-09-20', balance: 10000 },
    ])
  })
})

describe('getDefaultHistoryRange', () => {
  it('covers three months up to today', () => {
    const { from, to } = getDefaultHistoryRange(day(2026, 10, 11, 8))
    expect(from).toEqual(day(2026, 7, 11))
    expect(to).toEqual(day(2026, 10, 11))
  })
})
