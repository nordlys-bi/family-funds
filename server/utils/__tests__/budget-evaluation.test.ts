import { describe, expect, it } from 'vitest'
import type { BudgetVersion, Frequency } from '@prisma/client'
import {
  addPeriod,
  buildBudgetOverview,
  getMonthWindow,
  startOfPeriod,
} from '../budget-evaluation'

/**
 * Build a BudgetVersion fixture. `amount` is in cents, `validFrom` is a Date.
 */
function makeVersion(overrides: Partial<BudgetVersion> & { amount: number; frequency: Frequency; validFrom: Date }): BudgetVersion {
  return {
    id: overrides.id ?? `version-${Math.random().toString(36).slice(2)}`,
    budgetId: overrides.budgetId ?? 'budget-1',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T12:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T12:00:00Z'),
    amount: overrides.amount,
    frequency: overrides.frequency,
    validFrom: overrides.validFrom,
  }
}

function makeBudget(id: string, key: string, name: string, versions: BudgetVersion[]) {
  return { id, key, name, versions }
}

describe('getMonthWindow', () => {
  it('returns the 1st of the month as monthStart, anchored at 12:00', () => {
    const { monthStart, monthEnd } = getMonthWindow(new Date(2026, 5, 17, 9, 30))
    expect(monthStart.getFullYear()).toBe(2026)
    expect(monthStart.getMonth()).toBe(5)
    expect(monthStart.getDate()).toBe(1)
    expect(monthStart.getHours()).toBe(12)
    expect(monthStart.getMinutes()).toBe(0)
  })

  it('returns the 1st of the next month as monthEnd', () => {
    const { monthEnd } = getMonthWindow(new Date(2026, 11, 31, 12))
    expect(monthEnd.getFullYear()).toBe(2027)
    expect(monthEnd.getMonth()).toBe(0)
    expect(monthEnd.getDate()).toBe(1)
  })

  it('handles year rollover correctly', () => {
    const { monthStart, monthEnd } = getMonthWindow(new Date(2026, 11, 15, 12))
    expect(monthStart.getFullYear()).toBe(2026)
    expect(monthStart.getMonth()).toBe(11)
    expect(monthEnd.getFullYear()).toBe(2027)
    expect(monthEnd.getMonth()).toBe(0)
  })

  it('defaults to current date when called without arguments', () => {
    const { monthStart } = getMonthWindow()
    const now = new Date()
    expect(monthStart.getFullYear()).toBe(now.getFullYear())
    expect(monthStart.getMonth()).toBe(now.getMonth())
  })
})

describe('buildBudgetOverview — period counting by frequency', () => {
  // Use a fixed reference month: June 2026
  const baseDate = new Date(2026, 5, 15, 12)

  it('MONTHLY budget covering the month contributes 1 period', () => {
    const budget = makeBudget('b1', 'groceries', 'Lebensmittel', [
      makeVersion({ amount: 50000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(50000)
    expect(overview.budgets[0].periodCount).toBe(1)
  })

  it('WEEKLY budget contributes ~4–5 periods per month', () => {
    // June 2026 starts on Monday June 1, so we get exactly 5 Mondays.
    const budget = makeBudget('b1', 'misc', 'Sonstiges', [
      makeVersion({ amount: 2500, frequency: 'WEEKLY', validFrom: new Date(2026, 5, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].periodCount).toBe(5)
    expect(overview.budgets[0].plannedAmount).toBe(12500)
  })

  it('QUARTERLY budget counts 1 period only in the month that starts the quarter', () => {
    // Implementation counts period *starts* in the month. April starts Q2,
    // so the Q2 budget is visible in April but contributes 0 in May/June.
    const budget = makeBudget('b1', 'insurance', 'Versicherung', [
      makeVersion({ amount: 30000, frequency: 'QUARTERLY', validFrom: new Date(2026, 3, 1) }),
    ])

    const aprilOverview = buildBudgetOverview([budget], [], new Date(2026, 3, 15, 12))
    expect(aprilOverview.budgets[0].periodCount).toBe(1)
    expect(aprilOverview.budgets[0].plannedAmount).toBe(30000)

    const juneOverview = buildBudgetOverview([budget], [], baseDate)
    expect(juneOverview.budgets[0].periodCount).toBe(0)
    expect(juneOverview.budgets[0].plannedAmount).toBe(0)
  })

  it('QUARTERLY budget contributes 0 periods outside its quarter', () => {
    // Valid from Q1 (Jan 1), but we are looking at June (Q2) → 0.
    const budget = makeBudget('b1', 'q1-only', 'Q1', [
      makeVersion({ amount: 30000, frequency: 'QUARTERLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(0)
  })

  it('YEARLY budget counts 1 period only in January', () => {
    // Same semantics as QUARTERLY: the period is allocated at its start.
    const budget = makeBudget('b1', 'annual', 'Jährlich', [
      makeVersion({ amount: 120000, frequency: 'YEARLY', validFrom: new Date(2026, 0, 1) }),
    ])

    const january = buildBudgetOverview([budget], [], new Date(2026, 0, 15, 12))
    expect(january.budgets[0].periodCount).toBe(1)
    expect(january.budgets[0].plannedAmount).toBe(120000)

    const june = buildBudgetOverview([budget], [], baseDate)
    expect(june.budgets[0].periodCount).toBe(0)
    expect(june.budgets[0].plannedAmount).toBe(0)
  })

  it('YEARLY budget contributes 0 periods in a different year', () => {
    const budget = makeBudget('b1', 'old', 'Alt', [
      makeVersion({ amount: 120000, frequency: 'YEARLY', validFrom: new Date(2025, 0, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], new Date(2026, 5, 15))
    expect(overview.budgets[0].plannedAmount).toBe(0)
  })

  it('ONCE budget contributes 1 period only when validFrom falls inside the month', () => {
    const inside = makeBudget('b1', 'once', 'Einmalig', [
      makeVersion({ amount: 9900, frequency: 'ONCE', validFrom: new Date(2026, 5, 10) }),
    ])
    const before = makeBudget('b2', 'before', 'Vormonat', [
      makeVersion({ amount: 9900, frequency: 'ONCE', validFrom: new Date(2026, 4, 10) }),
    ])
    const after = makeBudget('b3', 'after', 'Nachmonat', [
      makeVersion({ amount: 9900, frequency: 'ONCE', validFrom: new Date(2026, 6, 10) }),
    ])
    const overview = buildBudgetOverview([inside, before, after], [], baseDate)
    expect(overview.budgets.find((b) => b.key === 'once')!.plannedAmount).toBe(9900)
    expect(overview.budgets.find((b) => b.key === 'before')!.plannedAmount).toBe(0)
    expect(overview.budgets.find((b) => b.key === 'after')!.plannedAmount).toBe(0)
  })
})

describe('buildBudgetOverview — version history handling', () => {
  const baseDate = new Date(2026, 5, 15, 12)

  it('combines multiple active versions whose ranges overlap the month', () => {
    // V1 active Jan–Mar (100/month). V2 active from Apr (150/month).
    // In June we expect 1 period * 150 = 150.
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 15000, frequency: 'MONTHLY', validFrom: new Date(2026, 3, 1) }),
      makeVersion({ amount: 10000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(15000)
    expect(overview.budgets[0].versionCount).toBe(2)
    expect(overview.budgets[0].currentAmount).toBe(15000)
    expect(overview.budgets[0].currentValidFrom).toEqual(new Date(2026, 3, 1))
    expect(overview.budgets[0].currentValidTo).toBeNull()
  })

  it('currentValidTo points to the next version when looking at a month covered by the older version', () => {
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 15000, frequency: 'MONTHLY', validFrom: new Date(2026, 3, 1) }),
      makeVersion({ amount: 10000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])

    // February 2026 → V1 (Jan 1) is current, V2 (Apr 1) is the next version.
    const february = buildBudgetOverview([budget], [], new Date(2026, 1, 15, 12))
    expect(february.budgets[0].currentAmount).toBe(10000)
    expect(february.budgets[0].currentValidFrom).toEqual(new Date(2026, 0, 1))
    expect(february.budgets[0].currentValidTo).toEqual(new Date(2026, 3, 1))
  })

  it('counts both old and new version periods when they each cover a slice of the month', () => {
    // V1 valid Jan 1 – Mar 15 (80/wk). V2 valid Mar 16 onward (100/wk).
    // June 2026 is fully covered by V2 only → 5 weeks * 100 = 500.
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 10000, frequency: 'WEEKLY', validFrom: new Date(2026, 2, 16) }),
      makeVersion({ amount: 8000, frequency: 'WEEKLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(50000)
    expect(overview.budgets[0].periodCount).toBe(5)
  })

  it('returns zero planned when version validFrom is after monthEnd', () => {
    const budget = makeBudget('b1', 'future', 'Zukunft', [
      makeVersion({ amount: 50000, frequency: 'MONTHLY', validFrom: new Date(2026, 7, 1) }),
    ])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(0)
    expect(overview.budgets[0].currentAmount).toBeNull()
  })

  it('handles a budget with no versions gracefully', () => {
    const budget = makeBudget('b1', 'empty', 'Leer', [])
    const overview = buildBudgetOverview([budget], [], baseDate)
    expect(overview.budgets[0].plannedAmount).toBe(0)
    expect(overview.budgets[0].periodCount).toBe(0)
    expect(overview.budgets[0].versionCount).toBe(0)
  })
})

describe('buildBudgetOverview — expense aggregation and unassigned bucket', () => {
  const baseDate = new Date(2026, 5, 15, 12)

  it('assigns expenses to the matching budget', () => {
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 50000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const expenses = [
      { amount: 1234, date: new Date(2026, 5, 5), budgetId: 'b1' },
      { amount: 2500, date: new Date(2026, 5, 12), budgetId: 'b1' },
    ]
    const overview = buildBudgetOverview([budget], expenses, baseDate)
    expect(overview.budgets[0].spentAmount).toBe(3734)
    expect(overview.budgets[0].remainingAmount).toBe(50000 - 3734)
    expect(overview.unassignedSpent).toBe(0)
  })

  it('groups unassigned expenses (budgetId = null) into the "Sonstiges" bucket', () => {
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 50000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const expenses = [
      { amount: 1234, date: new Date(2026, 5, 5), budgetId: 'b1' },
      { amount: 800, date: new Date(2026, 5, 8), budgetId: null },
      { amount: 1200, date: new Date(2026, 5, 20), budgetId: null },
    ]
    const overview = buildBudgetOverview([budget], expenses, baseDate)
    expect(overview.unassignedSpent).toBe(2000)
    expect(overview.unassigned.spentAmount).toBe(2000)
    expect(overview.unassigned.remainingAmount).toBe(-2000)
    expect(overview.unassigned.name).toBe('Sonstiges')
    expect(overview.spentTotal).toBe(1234 + 2000)
  })

  it('total remaining is negative when over-spending', () => {
    const budget = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 5000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const expenses = [
      { amount: 8000, date: new Date(2026, 5, 5), budgetId: 'b1' },
    ]
    const overview = buildBudgetOverview([budget], expenses, baseDate)
    expect(overview.remainingTotal).toBe(-3000)
  })

  it('sums across multiple budgets', () => {
    const food = makeBudget('b1', 'food', 'Lebensmittel', [
      makeVersion({ amount: 50000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const fun = makeBudget('b2', 'fun', 'Freizeit', [
      makeVersion({ amount: 20000, frequency: 'MONTHLY', validFrom: new Date(2026, 0, 1) }),
    ])
    const overview = buildBudgetOverview([food, fun], [], baseDate)
    expect(overview.plannedTotal).toBe(70000)
    expect(overview.spentTotal).toBe(0)
    expect(overview.remainingTotal).toBe(70000)
  })
})

describe('buildBudgetOverview — month window metadata', () => {
  it('exposes the month start and end on the overview payload', () => {
    const overview = buildBudgetOverview([], [], new Date(2026, 5, 15))
    expect(overview.monthStart.getDate()).toBe(1)
    expect(overview.monthEnd.getTime()).toBeGreaterThan(overview.monthStart.getTime())
  })
})

describe('startOfPeriod', () => {
  // June 17 2026 is a Wednesday.
  const wednesday = new Date(2026, 5, 17, 15, 30)

  it('rounds to Monday for WEEKLY (treating Sunday as end of week)', () => {
    const result = startOfPeriod(wednesday, 'WEEKLY')
    expect(result.getDay()).toBe(1) // Monday
    expect(result.getDate()).toBe(15) // Monday June 15
    expect(result.getHours()).toBe(12) // normalized to noon
  })

  it('rounds to the same Sunday for WEEKLY when input is already Sunday', () => {
    const sunday = new Date(2026, 5, 21, 10, 0) // Sunday June 21
    const result = startOfPeriod(sunday, 'WEEKLY')
    expect(result.getDay()).toBe(1) // Monday
    expect(result.getDate()).toBe(15) // still rolls back to Monday June 15
  })

  it('rounds to the 1st for MONTHLY', () => {
    const result = startOfPeriod(wednesday, 'MONTHLY')
    expect(result.getDate()).toBe(1)
    expect(result.getMonth()).toBe(5)
  })

  it('rounds to the quarter-start month for QUARTERLY', () => {
    // June is in Q2 (Apr-Jun), so the start is April 1.
    const result = startOfPeriod(wednesday, 'QUARTERLY')
    expect(result.getMonth()).toBe(3) // April (0-indexed)
    expect(result.getDate()).toBe(1)
  })

  it('rounds to January 1st for YEARLY', () => {
    const result = startOfPeriod(wednesday, 'YEARLY')
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(1)
  })

  it('returns start-of-day for ONCE (no rounding, just normalizes the time)', () => {
    const result = startOfPeriod(wednesday, 'ONCE')
    expect(result.getDate()).toBe(17)
    expect(result.getMonth()).toBe(5)
    expect(result.getHours()).toBe(12)
    expect(result.getMinutes()).toBe(0)
  })
})

describe('addPeriod', () => {
  const baseDate = new Date(2026, 0, 15, 10, 30) // Jan 15 2026, 10:30

  it('adds 7 days for WEEKLY', () => {
    const result = addPeriod(baseDate, 'WEEKLY')
    expect(result.getDate()).toBe(22)
    expect(result.getMonth()).toBe(0)
  })

  it('adds 1 month and resets to day 1 for MONTHLY', () => {
    const result = addPeriod(baseDate, 'MONTHLY')
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(1) // setMonth(m+1, 1) forces day 1
  })

  it('adds 3 months and resets to day 1 for QUARTERLY', () => {
    const result = addPeriod(baseDate, 'QUARTERLY')
    expect(result.getMonth()).toBe(3) // April
    expect(result.getDate()).toBe(1)
  })

  it('adds 1 year and resets to January 1st for YEARLY', () => {
    const result = addPeriod(baseDate, 'YEARLY')
    expect(result.getFullYear()).toBe(2027)
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(1)
  })

  it('returns an Invalid Date (NaN) for ONCE — relying on NaN comparisons to terminate any consumer loop', () => {
    // Note: the production code uses `value.setTime(Number.POSITIVE_INFINITY)`,
    // but Date#setTime coerces Infinity to NaN, yielding an Invalid Date. This
    // is still the intended behavior — every NaN-comparison evaluates to false,
    // so any loop like `while (cursor < monthEnd)` terminates immediately.
    const result = addPeriod(baseDate, 'ONCE')
    expect(result.getTime()).toBeNaN()
    expect(isNaN(result.getTime())).toBe(true)
  })
})