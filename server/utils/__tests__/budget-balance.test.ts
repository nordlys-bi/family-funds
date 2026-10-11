import { describe, expect, it } from 'vitest'
import type { Frequency } from '@prisma/client'
import {
  computeAllocations,
  computeBudgetBalances,
  getEarliestBalanceSince,
  type BalanceBudget,
} from '../budget-balance'

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

describe('computeAllocations', () => {
  it('credits one allocation per period start since balanceSince, including the current period', () => {
    const budget = makeBudget({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      versions: [{ amount: 10000, validFrom: day(2026, 7, 1) }],
    })
    // 1.9. und 1.10. — der 11.10. liegt in der Oktoberperiode
    expect(computeAllocations(budget, day(2026, 10, 11))).toBe(20000)
  })

  it('counts a period whose start is today, even before noon', () => {
    const budget = makeBudget({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      versions: [{ amount: 100, validFrom: day(2026, 6, 1) }],
    })
    // Montag 12.10., 08:00 → Wochen 14.9., 21.9., 28.9., 5.10., 12.10.
    expect(computeAllocations(budget, day(2026, 10, 12, 8))).toBe(500)
  })

  it('returns 0 before balanceSince', () => {
    const budget = makeBudget({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      versions: [{ amount: 100, validFrom: day(2026, 9, 1) }],
    })
    expect(computeAllocations(budget, day(2026, 8, 31))).toBe(0)
  })

  it('uses the version valid at each period start', () => {
    const budget = makeBudget({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      versions: [
        { amount: 100, validFrom: day(2026, 6, 1) },
        { amount: 300, validFrom: day(2026, 10, 5) },
      ],
    })
    // 14.9., 21.9., 28.9. à 100 + 5.10., 12.10. à 300
    expect(computeAllocations(budget, day(2026, 10, 12))).toBe(900)
  })

  it('applies a mid-period version only from the next period start', () => {
    const budget = makeBudget({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      versions: [
        { amount: 100, validFrom: day(2026, 7, 1) },
        { amount: 500, validFrom: day(2026, 9, 15) },
      ],
    })
    // September noch 100, Oktober 500
    expect(computeAllocations(budget, day(2026, 10, 2))).toBe(600)
  })

  it('lets the first version allocate its own period when nothing was valid at the period start', () => {
    const budget = makeBudget({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      versions: [{ amount: 100, validFrom: day(2026, 9, 16) }],
    })
    expect(computeAllocations(budget, day(2026, 9, 20))).toBe(100)
  })

  it('allocates nothing for periods without any version yet', () => {
    const budget = makeBudget({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      versions: [{ amount: 100, validFrom: day(2026, 10, 12) }],
    })
    expect(computeAllocations(budget, day(2026, 10, 12))).toBe(100)
  })

  it('stops allocating at closedAt (exclusive)', () => {
    const budget = makeBudget({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      closedAt: day(2026, 10, 5),
      versions: [{ amount: 100, validFrom: day(2026, 6, 1) }],
    })
    // 14.9., 21.9., 28.9. — die Woche ab 5.10. nicht mehr
    expect(computeAllocations(budget, day(2026, 12, 1))).toBe(300)
  })

  it('handles quarterly and yearly grids', () => {
    const quarterly = makeBudget({
      frequency: 'QUARTERLY',
      balanceSince: day(2026, 7, 1),
      versions: [{ amount: 100, validFrom: day(2026, 1, 1) }],
    })
    const yearly = makeBudget({
      frequency: 'YEARLY',
      balanceSince: day(2026, 1, 1),
      versions: [{ amount: 100, validFrom: day(2026, 1, 1) }],
    })
    expect(computeAllocations(quarterly, day(2026, 10, 11))).toBe(200)
    expect(computeAllocations(yearly, day(2027, 1, 1))).toBe(200)
  })

  it('allocates ONCE budgets exactly once at balanceSince', () => {
    const budget = makeBudget({
      frequency: 'ONCE',
      balanceSince: day(2026, 9, 14),
      versions: [{ amount: 5000, validFrom: day(2026, 8, 3) }],
    })
    expect(computeAllocations(budget, day(2026, 9, 13))).toBe(0)
    expect(computeAllocations(budget, day(2026, 9, 14))).toBe(5000)
    expect(computeAllocations(budget, day(2027, 9, 14))).toBe(5000)
  })

  it('allocates a ONCE budget whose only version starts after balanceSince', () => {
    const budget = makeBudget({
      frequency: 'ONCE',
      balanceSince: day(2026, 9, 14),
      versions: [{ amount: 5000, validFrom: day(2026, 10, 1) }],
    })
    expect(computeAllocations(budget, day(2026, 10, 11))).toBe(5000)
  })
})

describe('computeBudgetBalances', () => {
  const monthly = makeBudget({
    id: 'food',
    frequency: 'MONTHLY',
    balanceSince: day(2026, 9, 1),
    versions: [{ amount: 40000, validFrom: day(2026, 7, 1) }],
  })

  it('subtracts expenses and savings transfers since balanceSince', () => {
    const balances = computeBudgetBalances(
      [monthly],
      [
        { budgetId: 'food', amount: 30000, date: day(2026, 9, 10) },
        { budgetId: 'food', amount: 5000, date: day(2026, 10, 3) },
        // vor balanceSince: zaehlt nicht
        { budgetId: 'food', amount: 99999, date: day(2026, 8, 31) },
        // anderes Budget / ohne Budget: zaehlt nicht
        { budgetId: 'other', amount: 1, date: day(2026, 9, 10) },
        { budgetId: null, amount: 1, date: day(2026, 9, 10) },
      ],
      [
        { sourceBudgetId: 'food', amount: 10000, date: day(2026, 9, 30) },
        // negativ = aus dem Topf zurueck ins Budget
        { sourceBudgetId: 'food', amount: -2000, date: day(2026, 10, 5) },
      ],
      day(2026, 10, 11),
    )

    expect(balances.get('food')).toEqual({
      balance: 80000 - 35000 - 8000,
      allocated: 80000,
      spent: 35000,
      transferred: 8000,
      carriedOver: 0,
    })
  })

  it('counts bookings early on the balanceSince day and ignores future-dated ones', () => {
    const balances = computeBudgetBalances(
      [monthly],
      [
        { budgetId: 'food', amount: 100, date: day(2026, 9, 1, 0) },
        { budgetId: 'food', amount: 200, date: day(2026, 10, 11, 23) },
        { budgetId: 'food', amount: 400, date: day(2026, 10, 12) },
      ],
      [],
      day(2026, 10, 11, 9),
    )
    expect(balances.get('food')?.spent).toBe(300)
  })

  it('lets the balance go negative', () => {
    const balances = computeBudgetBalances(
      [monthly],
      [{ budgetId: 'food', amount: 100000, date: day(2026, 9, 2) }],
      [],
      day(2026, 9, 15),
    )
    expect(balances.get('food')?.balance).toBe(-60000)
  })

  it('carries the live final balance of a closed predecessor into its target from closedAt', () => {
    const weekly = makeBudget({
      id: 'weekly',
      frequency: 'WEEKLY',
      balanceSince: day(2026, 9, 14),
      closedAt: day(2026, 10, 5),
      carryoverToBudgetId: 'monthly',
      versions: [{ amount: 10000, validFrom: day(2026, 6, 1) }],
    })
    const target = makeBudget({
      id: 'monthly',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 10, 1),
      versions: [{ amount: 40000, validFrom: day(2026, 10, 1) }],
    })
    const expenses = [
      { budgetId: 'weekly', amount: 25000, date: day(2026, 9, 20) },
      // Nachbuchung vor dem Stichtag fliesst automatisch weiter
      { budgetId: 'weekly', amount: 1000, date: day(2026, 10, 4) },
      { budgetId: 'monthly', amount: 3000, date: day(2026, 10, 6) },
    ]

    // vor dem Stichtag: noch kein Uebertrag
    const before = computeBudgetBalances([weekly, target], expenses, [], day(2026, 10, 4))
    expect(before.get('monthly')?.carriedOver).toBe(0)

    const after = computeBudgetBalances([weekly, target], expenses, [], day(2026, 10, 11))
    // weekly: 3 × 10000 − 26000 = 4000 (keine Zuteilung ab 5.10.)
    expect(after.get('weekly')?.balance).toBe(4000)
    expect(after.get('monthly')).toMatchObject({ carriedOver: 4000, balance: 40000 - 3000 + 4000 })
  })

  it('carries over at the later of closedAt and the target balanceSince', () => {
    const old = makeBudget({
      id: 'old',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      closedAt: day(2026, 10, 1),
      carryoverToBudgetId: 'new',
      versions: [{ amount: 100, validFrom: day(2026, 9, 1) }],
    })
    const target = makeBudget({
      id: 'new',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 11, 1),
      versions: [{ amount: 1000, validFrom: day(2026, 11, 1) }],
    })
    expect(computeBudgetBalances([old, target], [], [], day(2026, 10, 15)).get('new')?.balance).toBe(0)
    expect(computeBudgetBalances([old, target], [], [], day(2026, 11, 1)).get('new')?.balance).toBe(1100)
  })

  it('resolves chains recursively', () => {
    const a = makeBudget({
      id: 'a',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      closedAt: day(2026, 10, 1),
      carryoverToBudgetId: 'b',
      versions: [{ amount: 100, validFrom: day(2026, 9, 1) }],
    })
    const b = makeBudget({
      id: 'b',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 10, 1),
      closedAt: day(2026, 11, 1),
      carryoverToBudgetId: 'c',
      versions: [{ amount: 200, validFrom: day(2026, 10, 1) }],
    })
    const c = makeBudget({
      id: 'c',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 11, 1),
      versions: [{ amount: 400, validFrom: day(2026, 11, 1) }],
    })
    const balances = computeBudgetBalances([c, b, a], [{ budgetId: 'a', amount: 50, date: day(2026, 9, 5) }], [], day(2026, 11, 2))
    expect(balances.get('a')?.balance).toBe(50)
    expect(balances.get('b')?.balance).toBe(250)
    expect(balances.get('c')?.balance).toBe(650)
  })

  it('does not loop forever on a (forbidden) carryover cycle', () => {
    const a = makeBudget({
      id: 'a',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      closedAt: day(2026, 10, 1),
      carryoverToBudgetId: 'b',
      versions: [{ amount: 100, validFrom: day(2026, 9, 1) }],
    })
    const b = makeBudget({
      id: 'b',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 9, 1),
      closedAt: day(2026, 10, 1),
      carryoverToBudgetId: 'a',
      versions: [{ amount: 100, validFrom: day(2026, 9, 1) }],
    })
    expect(() => computeBudgetBalances([a, b], [], [], day(2026, 11, 1))).not.toThrow()
  })
})

describe('getEarliestBalanceSince', () => {
  it('returns null for no budgets and the minimum otherwise', () => {
    expect(getEarliestBalanceSince([])).toBeNull()
    expect(getEarliestBalanceSince([{ balanceSince: day(2026, 9, 1) }, { balanceSince: day(2026, 7, 1) }])).toEqual(day(2026, 7, 1))
  })
})
