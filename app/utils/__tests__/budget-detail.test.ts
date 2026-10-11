import { describe, expect, it } from 'vitest'
import {
  allHistoryFrom,
  balanceOnDay,
  balanceTrendOf,
  groupEntriesByPeriod,
  nearestIndex,
  nextPeriodStartDay,
  periodStartDay,
  periodTicks,
  projectedPeriodEndBalance,
  showsPeriodForecast,
  summarizeBalanceHistory,
  trendVersusPreviousPeriod,
} from '../budget-detail'

const points = [
  { date: '2026-07-11', balance: 5000 },
  { date: '2026-08-01', balance: 45000 },
  { date: '2026-08-20', balance: -2000 },
  { date: '2026-09-01', balance: 38000 },
  { date: '2026-10-11', balance: 9200 },
]

describe('balanceOnDay', () => {
  it('takes the last point up to and including the day', () => {
    expect(balanceOnDay(points, '2026-08-20')).toBe(-2000)
    expect(balanceOnDay(points, '2026-08-31')).toBe(-2000)
    expect(balanceOnDay(points, '2026-12-31')).toBe(9200)
  })

  it('falls back to the first point before the range', () => {
    expect(balanceOnDay(points, '2026-01-01')).toBe(5000)
    expect(balanceOnDay([], '2026-01-01')).toBe(0)
  })
})

describe('balanceTrendOf', () => {
  it('is the difference between first and last point', () => {
    expect(balanceTrendOf(points)).toEqual({ since: '2026-07-11', delta: 4200 })
  })

  it('needs at least two points', () => {
    expect(balanceTrendOf([])).toBeNull()
    expect(balanceTrendOf([{ date: '2026-10-11', balance: 100 }])).toBeNull()
  })
})

describe('projectedPeriodEndBalance', () => {
  it('subtracts the still expected spending of this period', () => {
    expect(projectedPeriodEndBalance(10000, { spentAmount: 31200, forecast: { forecastTotal: 41200 } })).toBe(0)
  })

  it('never adds money when the forecast is below what was already spent', () => {
    expect(projectedPeriodEndBalance(10000, { spentAmount: 5000, forecast: { forecastTotal: 4000 } })).toBe(10000)
  })

  it('is null without a forecast', () => {
    expect(projectedPeriodEndBalance(10000, null)).toBeNull()
    expect(projectedPeriodEndBalance(10000, { spentAmount: 0, forecast: null })).toBeNull()
  })
})

describe('summarizeBalanceHistory', () => {
  it('reports start, end, minimum with date and negative days', () => {
    expect(summarizeBalanceHistory(points)).toEqual({
      start: 5000,
      end: 9200,
      min: { balance: -2000, date: '2026-08-20' },
      // 20.8. bis einschliesslich 31.8.
      daysNegative: 12,
    })
  })

  it('counts a negative last point as one day', () => {
    expect(summarizeBalanceHistory([
      { date: '2026-10-01', balance: 100 },
      { date: '2026-10-11', balance: -100 },
    ])?.daysNegative).toBe(1)
  })

  it('is null without points', () => {
    expect(summarizeBalanceHistory([])).toBeNull()
  })
})

describe('nearestIndex', () => {
  it('snaps to the closest value', () => {
    expect(nearestIndex([0, 50, 120, 300], 80)).toBe(1)
    expect(nearestIndex([0, 50, 120, 300], 90)).toBe(2)
    expect(nearestIndex([0, 50, 120, 300], 999)).toBe(3)
    expect(nearestIndex([0, 50, 120, 300], -10)).toBe(0)
  })

  it('prefers the later point on a tie (start balance vs. event on the first day)', () => {
    expect(nearestIndex([10, 10, 60], 10)).toBe(1)
  })

  it('returns -1 for no values', () => {
    expect(nearestIndex([], 5)).toBe(-1)
  })
})

describe('periodStartDay / nextPeriodStartDay', () => {
  it('follows the server period grid', () => {
    // 11.10.2026 ist ein Sonntag → Montag 5.10.
    expect(periodStartDay('2026-10-11', 'WEEKLY')).toBe('2026-10-05')
    expect(periodStartDay('2026-10-05', 'WEEKLY')).toBe('2026-10-05')
    expect(periodStartDay('2026-10-11', 'MONTHLY')).toBe('2026-10-01')
    expect(periodStartDay('2026-11-30', 'QUARTERLY')).toBe('2026-10-01')
    expect(periodStartDay('2026-03-31', 'QUARTERLY')).toBe('2026-01-01')
    expect(periodStartDay('2026-10-11', 'YEARLY')).toBe('2026-01-01')
    expect(periodStartDay('2026-10-11', 'ONCE')).toBeNull()
  })

  it('computes the exclusive end across year boundaries', () => {
    expect(nextPeriodStartDay('2026-12-28', 'WEEKLY')).toBe('2027-01-04')
    expect(nextPeriodStartDay('2026-12-01', 'MONTHLY')).toBe('2027-01-01')
    expect(nextPeriodStartDay('2026-10-01', 'QUARTERLY')).toBe('2027-01-01')
    expect(nextPeriodStartDay('2026-01-01', 'YEARLY')).toBe('2027-01-01')
    expect(nextPeriodStartDay('2026-01-01', 'ONCE')).toBeNull()
  })
})

describe('groupEntriesByPeriod', () => {
  const entries = [
    { type: 'allocation', date: '2026-08-01', amount: 40000 },
    { type: 'expense', date: '2026-08-20', amount: -47000, id: 'e1' },
    { type: 'allocation', date: '2026-09-01', amount: 40000 },
    { type: 'expense', date: '2026-09-03', amount: -1000, id: 'e2' },
    { type: 'transfer', date: '2026-09-10', amount: -1800, id: 't1' },
    { type: 'expense', date: '2026-10-08', amount: -28800, id: 'e3' },
  ]

  it('groups by budget period, newest first, allocations in the header', () => {
    const groups = groupEntriesByPeriod(entries, 'MONTHLY', points)
    expect(groups.map((group) => group.start)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01'])

    const september = groups[1]!
    expect(september).toMatchObject({ end: '2026-10-01', allocation: 40000, inflow: 40000, outflow: -2800 })
    expect(september.entries.map((entry) => entry.date)).toEqual(['2026-09-10', '2026-09-03'])
    // Saldo am 30.9. (letzter Punkt davor: 1.9.)
    expect(september.endBalance).toBe(38000)
  })

  it('caps the end balance of the running period at the last point', () => {
    const october = groupEntriesByPeriod(entries, 'MONTHLY', points)[0]!
    expect(october.allocation).toBe(0)
    expect(october.endBalance).toBe(9200)
  })

  it('puts everything into one group for ONCE budgets', () => {
    const groups = groupEntriesByPeriod(entries, 'ONCE', points)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ start: '2026-08-01', end: null, allocation: 80000, endBalance: 9200 })
    expect(groups[0]!.entries).toHaveLength(4)
  })

  it('returns no groups for no entries', () => {
    expect(groupEntriesByPeriod([], 'MONTHLY', points)).toEqual([])
  })
})

describe('allHistoryFrom', () => {
  const budgets = [
    { id: 'c', balanceSince: '2026-09-28', carryoverToBudgetId: null },
    { id: 'b', balanceSince: '2026-05-01', carryoverToBudgetId: 'c' },
    { id: 'a', balanceSince: '2025-01-01', carryoverToBudgetId: 'b' },
    { id: 'x', balanceSince: '2020-01-01', carryoverToBudgetId: null },
  ]

  it('goes back to the earliest predecessor in the chain', () => {
    expect(allHistoryFrom('c', budgets, '2026-10-11', 10000)).toBe('2025-01-01')
    expect(allHistoryFrom('b', budgets, '2026-10-11', 10000)).toBe('2025-01-01')
  })

  it('ignores unrelated budgets and respects the server limit', () => {
    expect(allHistoryFrom('c', budgets, '2026-10-11', 365)).toBe('2025-10-11')
    expect(allHistoryFrom('x', budgets.slice(0, 3), '2026-10-11', 10000)).toBe('2026-10-11')
  })
})

describe('showsPeriodForecast', () => {
  it('hides the forecast on the last day of a week (Sunday)', () => {
    // KW 41: 5.–11.10., Ende exklusiv 12.10.
    expect(showsPeriodForecast('2026-10-12', '2026-10-11')).toBe(false)
    expect(showsPeriodForecast('2026-10-12', '2026-10-10')).toBe(true)
  })

  it('hides it on the last day of a month, also with ISO timestamps from the server', () => {
    expect(showsPeriodForecast('2026-11-01T11:00:00.000Z', '2026-10-31')).toBe(false)
    expect(showsPeriodForecast('2026-11-01T11:00:00.000Z', '2026-10-30')).toBe(true)
  })

  it('has no forecast without a period end (ONCE)', () => {
    expect(showsPeriodForecast(null, '2026-10-11')).toBe(false)
  })
})

describe('trendVersusPreviousPeriod', () => {
  const weekly = [
    { date: '2026-09-14', balance: 0 },
    { date: '2026-09-14', balance: 25000 },
    { date: '2026-10-04', balance: -4551 },
    { date: '2026-10-05', balance: 20449 },
    { date: '2026-10-11', balance: -4881 },
  ]

  it('compares with the balance at the end of the previous period', () => {
    expect(trendVersusPreviousPeriod(weekly, '2026-10-05', 'WEEKLY')).toEqual({ delta: -330, label: 'ggü. Vorwoche' })
  })

  it('is null when the history does not reach the previous period', () => {
    // Budget startet in dieser Woche: Vortag liegt vor dem ersten Punkt.
    expect(trendVersusPreviousPeriod(weekly, '2026-09-14', 'WEEKLY')).toBeNull()
  })

  it('is null for ONCE and without points', () => {
    expect(trendVersusPreviousPeriod(weekly, '2026-10-05', 'ONCE')).toBeNull()
    expect(trendVersusPreviousPeriod([], '2026-10-05', 'WEEKLY')).toBeNull()
  })

  it('accepts the ISO period start from the server', () => {
    expect(trendVersusPreviousPeriod(weekly, '2026-10-05T10:00:00.000Z', 'WEEKLY')?.delta).toBe(-330)
  })
})

describe('periodTicks', () => {
  it('marks every Monday after from for weekly budgets', () => {
    expect(periodTicks('2026-09-14', '2026-10-11', 'WEEKLY', 10).map((tick) => tick.date))
      .toEqual(['2026-09-21', '2026-09-28', '2026-10-05'])
  })

  it('marks month starts for monthly budgets, including to', () => {
    expect(periodTicks('2026-07-11', '2026-10-01', 'MONTHLY', 10).map((tick) => tick.date))
      .toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  })

  it('thins labels evenly but keeps every line', () => {
    const ticks = periodTicks('2026-01-01', '2026-10-11', 'WEEKLY', 5)
    expect(ticks).toHaveLength(40)
    expect(ticks.filter((tick) => tick.labeled).length).toBeLessThanOrEqual(5)
    expect(ticks[0]!.labeled).toBe(true)
  })

  it('has no ticks for ONCE', () => {
    expect(periodTicks('2026-01-01', '2026-10-11', 'ONCE', 5)).toEqual([])
  })
})
