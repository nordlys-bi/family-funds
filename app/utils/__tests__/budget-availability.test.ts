import { describe, expect, it } from 'vitest'
import { budgetsOpenOn, getNextPeriodStartDate, isBudgetOpenOn } from '../budget-availability'

describe('isBudgetOpenOn', () => {
  it('keeps open budgets available', () => {
    expect(isBudgetOpenOn({ closedAt: null }, '2030-01-01')).toBe(true)
    expect(isBudgetOpenOn({}, new Date())).toBe(true)
  })

  it('closes from the closing date on (exclusive, day-based)', () => {
    const budget = { closedAt: '2026-10-05T10:00:00.000Z' }
    expect(isBudgetOpenOn(budget, new Date(2026, 9, 4, 23))).toBe(true)
    expect(isBudgetOpenOn(budget, new Date(2026, 9, 5, 8))).toBe(false)
  })
})

describe('budgetsOpenOn', () => {
  const budgets = [
    { id: 'open', closedAt: null },
    { id: 'closed', closedAt: '2026-10-05T10:00:00.000Z' },
  ]

  it('filters by booking date', () => {
    expect(budgetsOpenOn(budgets, new Date(2026, 9, 1)).map((b) => b.id)).toEqual(['open', 'closed'])
    expect(budgetsOpenOn(budgets, new Date(2026, 9, 6)).map((b) => b.id)).toEqual(['open'])
  })

  it('hides closed budgets when no date is known', () => {
    expect(budgetsOpenOn(budgets, null).map((b) => b.id)).toEqual(['open'])
  })
})

describe('getNextPeriodStartDate', () => {
  it('returns the start of the following period', () => {
    const base = new Date(2026, 9, 11, 9) // So, 11.10.2026
    expect(getNextPeriodStartDate(base, 'WEEKLY').getDate()).toBe(12)
    expect(getNextPeriodStartDate(base, 'MONTHLY')).toEqual(new Date(2026, 10, 1, 12))
    expect(getNextPeriodStartDate(base, 'QUARTERLY')).toEqual(new Date(2027, 0, 1, 12))
    expect(getNextPeriodStartDate(base, 'YEARLY')).toEqual(new Date(2027, 0, 1, 12))
    expect(getNextPeriodStartDate(base, 'ONCE')).toEqual(new Date(2026, 9, 12, 12))
  })
})
