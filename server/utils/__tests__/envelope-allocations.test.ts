import { describe, expect, it } from 'vitest'
import type { Frequency } from '@prisma/client'
import {
  classifyEnvelopeSeverity,
  computeAllocationAmount,
  computePeriodAvailability,
  computeReservedAmount,
  getReservationHorizon,
  listDueAllocations,
  listReservedAllocations,
  projectPeriodEndBalance,
  type AllocationEnvelope,
  type AllocationPlan,
  type AllocationRule,
} from '../envelope-allocations'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

function makeEnvelope(
  overrides: Partial<AllocationEnvelope> & { frequency: Frequency; balanceSince: Date; rule: AllocationRule },
): AllocationEnvelope {
  return { closedAt: null, ...overrides }
}

function plan(amount: number, frequency: Frequency, startDate: Date, endDate: Date | null = null): AllocationPlan {
  return { amount, frequency, startDate, endDate }
}

/** Zuteilungen der Monate Jan–Dez 2026 eines Monatsumschlags. */
function monthlyAmounts(envelope: AllocationEnvelope) {
  return Array.from({ length: 12 }, (_, index) => computeAllocationAmount(envelope, day(2026, index + 1, 1)))
}

describe('computeAllocationAmount', () => {
  it('returns the fixed amount for every period', () => {
    const envelope = makeEnvelope({ frequency: 'WEEKLY', balanceSince: day(2026, 9, 14), rule: { kind: 'fixed', amount: 30000 } })
    expect(computeAllocationAmount(envelope, day(2026, 11, 2))).toBe(30000)
  })

  it('returns 0 without a rule', () => {
    const envelope = makeEnvelope({ frequency: 'MONTHLY', balanceSince: day(2026, 9, 1), rule: { kind: 'none' } })
    expect(computeAllocationAmount(envelope, day(2026, 11, 1))).toBe(0)
  })

  it('spreads a yearly plan evenly over a monthly envelope', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: { kind: 'plans', plans: [plan(60000, 'YEARLY', day(2025, 3, 15))] },
    })
    expect(monthlyAmounts(envelope)).toEqual(Array(12).fill(5000))
  })

  it('rounds cumulatively so a year adds up to the cent', () => {
    // 400 € / 12 = 33,333… € — 12 × 33,33 € ergäbe 399,96 €
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: { kind: 'plans', plans: [plan(40000, 'YEARLY', day(2026, 1, 1))] },
    })
    const amounts = monthlyAmounts(envelope)
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(40000)
    expect(new Set(amounts)).toEqual(new Set([3333, 3334]))
  })

  it('splits a quarterly plan into thirds and a monthly plan unchanged', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: {
        kind: 'plans',
        plans: [plan(30000, 'QUARTERLY', day(2026, 1, 1)), plan(95000, 'MONTHLY', day(2026, 1, 1))],
      },
    })
    expect(monthlyAmounts(envelope)).toEqual(Array(12).fill(10000 + 95000))
  })

  it('converts a weekly plan by the mean number of weeks per year', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: { kind: 'plans', plans: [plan(700, 'WEEKLY', day(2026, 1, 1))] },
    })
    // 7 € × 365,25/7 Wochen = 365,25 € pro Jahr
    expect(monthlyAmounts(envelope).reduce((sum, amount) => sum + amount, 0)).toBe(36525)
  })

  it('scales a monthly plan down for a weekly envelope', () => {
    const envelope = makeEnvelope({
      frequency: 'WEEKLY',
      balanceSince: day(2026, 1, 5),
      rule: { kind: 'plans', plans: [plan(1000, 'MONTHLY', day(2026, 1, 1))] },
    })
    // 10 € × 12 / (365,25/7) ≈ 2,30 € pro Woche
    expect(computeAllocationAmount(envelope, day(2026, 1, 5))).toBe(230)
  })

  it('only allocates for plans active in the period', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: {
        kind: 'plans',
        // Startet mitten im März, endet mitten im Juni: März bis Juni beruehrt
        plans: [plan(1200, 'MONTHLY', day(2026, 3, 15), day(2026, 6, 15))],
      },
    })
    expect(monthlyAmounts(envelope)).toEqual([0, 0, 1200, 1200, 1200, 1200, 0, 0, 0, 0, 0, 0])
  })

  it('starts counting a plan at balanceSince, not at its own start', () => {
    // Plan seit 2025 aktiv, Umschlag erst seit Juli 2026 — die Rundung
    // beginnt mit der ersten Umschlag-Periode und summiert ab dort genau.
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 7, 1),
      rule: { kind: 'plans', plans: [plan(40000, 'YEARLY', day(2025, 1, 1))] },
    })
    const firstSix = [7, 8, 9, 10, 11, 12].map((month) => computeAllocationAmount(envelope, day(2026, month, 1)))
    expect(firstSix.reduce((sum, amount) => sum + amount, 0)).toBe(20000)
  })

  it('allocates a ONCE plan in full in the period of its date', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: { kind: 'plans', plans: [plan(25000, 'ONCE', day(2026, 5, 20))] },
    })
    expect(monthlyAmounts(envelope)).toEqual([0, 0, 0, 0, 25000, 0, 0, 0, 0, 0, 0, 0])
  })

  it('sums several plans in one envelope', () => {
    const envelope = makeEnvelope({
      frequency: 'MONTHLY',
      balanceSince: day(2026, 1, 1),
      rule: {
        kind: 'plans',
        plans: [plan(95000, 'MONTHLY', day(2026, 1, 1)), plan(1299, 'MONTHLY', day(2026, 1, 1)), plan(60000, 'YEARLY', day(2026, 1, 1))],
      },
    })
    expect(computeAllocationAmount(envelope, day(2026, 4, 1))).toBe(95000 + 1299 + 5000)
  })

  it('does not derive allocations from plans for a ONCE envelope', () => {
    const envelope = makeEnvelope({
      frequency: 'ONCE',
      balanceSince: day(2026, 1, 1),
      rule: { kind: 'plans', plans: [plan(60000, 'YEARLY', day(2026, 1, 1))] },
    })
    expect(computeAllocationAmount(envelope, day(2026, 1, 1))).toBe(0)
  })
})

describe('listDueAllocations', () => {
  const weekly = makeEnvelope({ frequency: 'WEEKLY', balanceSince: day(2026, 10, 5), rule: { kind: 'fixed', amount: 30000 } })

  it('lists every started period since balanceSince that is not booked yet', () => {
    const due = listDueAllocations(weekly, day(2026, 10, 21), [day(2026, 10, 5)])
    expect(due).toEqual([
      { periodStart: day(2026, 10, 12), amount: 30000 },
      { periodStart: day(2026, 10, 19), amount: 30000 },
    ])
  })

  it('includes a period starting today, even before noon', () => {
    const due = listDueAllocations(weekly, day(2026, 10, 19, 6), [day(2026, 10, 5), day(2026, 10, 12)])
    expect(due.map((item) => item.periodStart)).toEqual([day(2026, 10, 19)])
  })

  it('treats booked periods as done regardless of their time of day', () => {
    const booked = [day(2026, 10, 5, 0), day(2026, 10, 12, 23)]
    expect(listDueAllocations(weekly, day(2026, 10, 13), booked)).toEqual([])
  })

  it('stops at closedAt', () => {
    const closed = { ...weekly, closedAt: day(2026, 10, 19) }
    expect(listDueAllocations(closed, day(2026, 11, 30), []).map((item) => item.periodStart)).toEqual([
      day(2026, 10, 5),
      day(2026, 10, 12),
    ])
  })

  it('catches up all missed periods at once', () => {
    const monthly = makeEnvelope({ frequency: 'MONTHLY', balanceSince: day(2026, 8, 1), rule: { kind: 'fixed', amount: 15000 } })
    expect(listDueAllocations(monthly, day(2026, 11, 3), [day(2026, 8, 1)]).map((item) => item.periodStart)).toEqual([
      day(2026, 9, 1),
      day(2026, 10, 1),
      day(2026, 11, 1),
    ])
  })

  it('books a period whose rule yields 0 so it counts as done', () => {
    const empty = makeEnvelope({ frequency: 'MONTHLY', balanceSince: day(2026, 11, 1), rule: { kind: 'plans', plans: [] } })
    expect(listDueAllocations(empty, day(2026, 11, 3), [])).toEqual([{ periodStart: day(2026, 11, 1), amount: 0 }])
  })

  it('creates nothing for an envelope without a rule', () => {
    const personal = makeEnvelope({ frequency: 'MONTHLY', balanceSince: day(2026, 1, 1), rule: { kind: 'none' } })
    expect(listDueAllocations(personal, day(2026, 11, 3), [])).toEqual([])
  })

  it('allocates a ONCE envelope exactly once at balanceSince', () => {
    const once = makeEnvelope({ frequency: 'ONCE', balanceSince: day(2026, 10, 10), rule: { kind: 'fixed', amount: 50000 } })
    expect(listDueAllocations(once, day(2026, 10, 9), [])).toEqual([])
    expect(listDueAllocations(once, day(2026, 12, 1), [])).toEqual([{ periodStart: day(2026, 10, 10), amount: 50000 }])
    expect(listDueAllocations(once, day(2026, 12, 1), [day(2026, 10, 10)])).toEqual([])
  })
})

describe('listReservedAllocations', () => {
  const groceries = makeEnvelope({ frequency: 'WEEKLY', balanceSince: day(2026, 9, 14), rule: { kind: 'fixed', amount: 30000 } })

  it('reserves the remaining weeks of the month, including a fifth Monday', () => {
    // November 2026 hat fuenf Montage (2., 9., 16., 23., 30.)
    const reserved = listReservedAllocations(groceries, day(2026, 11, 3))
    expect(reserved.map((item) => item.periodStart)).toEqual([
      day(2026, 11, 9),
      day(2026, 11, 16),
      day(2026, 11, 23),
      day(2026, 11, 30),
    ])
    expect(computeReservedAmount([groceries], day(2026, 11, 3))).toBe(120000)
  })

  it('keeps a week spanning the month boundary in the month of its Monday', () => {
    // Die Woche ab 30.11. gehoert zum November, nicht zum Dezember
    expect(listReservedAllocations(groceries, day(2026, 11, 29)).map((item) => item.periodStart)).toEqual([day(2026, 11, 30)])
    expect(listReservedAllocations(groceries, day(2026, 12, 1)).map((item) => item.periodStart)).toEqual([
      day(2026, 12, 7),
      day(2026, 12, 14),
      day(2026, 12, 21),
      day(2026, 12, 28),
    ])
  })

  it('does not reserve a period that starts today — it is due, not reserved', () => {
    expect(listReservedAllocations(groceries, day(2026, 11, 9)).map((item) => item.periodStart)).not.toContainEqual(day(2026, 11, 9))
  })

  it('reserves nothing for a monthly envelope within the month', () => {
    const monthly = makeEnvelope({ frequency: 'MONTHLY', balanceSince: day(2026, 1, 1), rule: { kind: 'fixed', amount: 25000 } })
    expect(listReservedAllocations(monthly, day(2026, 11, 3))).toEqual([])
  })

  it('reserves nothing after closedAt or without a rule', () => {
    const closed = { ...groceries, closedAt: day(2026, 11, 16) }
    expect(listReservedAllocations(closed, day(2026, 11, 3)).map((item) => item.periodStart)).toEqual([day(2026, 11, 9)])
    const personal = makeEnvelope({ frequency: 'WEEKLY', balanceSince: day(2026, 1, 5), rule: { kind: 'none' } })
    expect(listReservedAllocations(personal, day(2026, 11, 3))).toEqual([])
  })

  it('does not reserve before balanceSince', () => {
    const future = makeEnvelope({ frequency: 'WEEKLY', balanceSince: day(2026, 11, 23), rule: { kind: 'fixed', amount: 30000 } })
    expect(listReservedAllocations(future, day(2026, 11, 3)).map((item) => item.periodStart)).toEqual([
      day(2026, 11, 23),
      day(2026, 11, 30),
    ])
  })

  it('ends the horizon on the first of the next month, also across the year', () => {
    expect(getReservationHorizon(day(2026, 11, 3))).toEqual(day(2026, 12, 1))
    expect(getReservationHorizon(day(2026, 12, 31))).toEqual(day(2027, 1, 1))
  })
})

describe('computePeriodAvailability', () => {
  it('adds the carried balance to the period allocation', () => {
    // Tanken aus dem Feedback: 79,15 € Vorsaldo + 300 € Zuteilung, 353,29 € ausgegeben → Saldo 25,86 €
    const result = computePeriodAvailability({ balanceBeforePeriod: 7915, periodAllocation: 30000, spent: 35329 })
    expect(result.available).toBe(37915)
    expect(result.available - result.spent).toBe(2586)
    expect(result.percentUsed).toBeCloseTo(93.18, 2)
  })

  it('returns no percentage when nothing was available', () => {
    expect(computePeriodAvailability({ balanceBeforePeriod: -40000, periodAllocation: 25000, spent: 1000 }).percentUsed).toBeNull()
  })
})

describe('projectPeriodEndBalance', () => {
  it('subtracts only the projected rest of the period', () => {
    expect(projectPeriodEndBalance(5000, 20000, 26000)).toBe(-1000)
  })

  it('never adds money when the forecast is below the spending so far', () => {
    expect(projectPeriodEndBalance(5000, 20000, 18000)).toBe(5000)
  })
})

describe('classifyEnvelopeSeverity', () => {
  it('is ok with a positive balance even if the period allocation is exceeded', () => {
    expect(classifyEnvelopeSeverity({ balance: 2586, projectedPeriodEndBalance: 2586 })).toBe('ok')
  })

  it('warns when the forecast for the period end is negative', () => {
    expect(classifyEnvelopeSeverity({ balance: 4000, projectedPeriodEndBalance: -500 })).toBe('warning')
  })

  it('is over as soon as the balance is negative', () => {
    expect(classifyEnvelopeSeverity({ balance: -1, projectedPeriodEndBalance: null })).toBe('over')
  })

  it('is ok without a forecast', () => {
    expect(classifyEnvelopeSeverity({ balance: 0, projectedPeriodEndBalance: null })).toBe('ok')
  })
})
