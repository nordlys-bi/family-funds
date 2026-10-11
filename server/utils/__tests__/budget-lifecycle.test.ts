import { describe, expect, it } from 'vitest'
import { assertBudgetOpenOn, assertCanCloseBudget, isBudgetOpenOn } from '../budget-lifecycle'

function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

describe('isBudgetOpenOn / assertBudgetOpenOn', () => {
  it('treats open budgets as always open', () => {
    expect(isBudgetOpenOn({ closedAt: null }, day(2030, 1, 1))).toBe(true)
  })

  it('is open before the closing date and closed from it on (day-based)', () => {
    const budget = { closedAt: day(2026, 10, 5) }
    expect(isBudgetOpenOn(budget, day(2026, 10, 4, 23))).toBe(true)
    // auch vor 12:00 am Stichtag schon geschlossen
    expect(isBudgetOpenOn(budget, day(2026, 10, 5, 8))).toBe(false)
    expect(() => assertBudgetOpenOn(budget, day(2026, 10, 6))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('assertCanCloseBudget', () => {
  const weekly = {
    id: 'weekly',
    householdId: 'h1',
    frequency: 'WEEKLY' as const,
    balanceSince: day(2026, 9, 14),
    closedAt: null,
  }
  const monthly = {
    id: 'monthly',
    householdId: 'h1',
    frequency: 'MONTHLY' as const,
    balanceSince: day(2026, 10, 1),
    closedAt: null,
  }

  it('accepts a period start with an open target in the same household', () => {
    expect(() => assertCanCloseBudget(weekly, monthly, day(2026, 10, 5))).not.toThrow()
  })

  it('rejects a closing date that is not a period start', () => {
    expect(() => assertCanCloseBudget(weekly, monthly, day(2026, 10, 6))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects a closing date before the balance start', () => {
    expect(() => assertCanCloseBudget(weekly, monthly, day(2026, 9, 7))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects an already closed budget with 409', () => {
    expect(() => assertCanCloseBudget({ ...weekly, closedAt: day(2026, 10, 5) }, monthly, day(2026, 10, 12)))
      .toThrow(expect.objectContaining({ statusCode: 409 }))
  })

  it('requires a target from the same household', () => {
    expect(() => assertCanCloseBudget(weekly, null, day(2026, 10, 5))).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => assertCanCloseBudget(weekly, { ...monthly, householdId: 'h2' }, day(2026, 10, 5)))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('rejects closing a budget into itself', () => {
    expect(() => assertCanCloseBudget(weekly, weekly, day(2026, 10, 5))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects a target that is already closed on the closing date (no cycles)', () => {
    expect(() => assertCanCloseBudget(weekly, { ...monthly, closedAt: day(2026, 10, 1) }, day(2026, 10, 5)))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    // spaeter geschlossenes Ziel ist ok
    expect(() => assertCanCloseBudget(weekly, { ...monthly, closedAt: day(2026, 11, 1) }, day(2026, 10, 5))).not.toThrow()
  })
})
