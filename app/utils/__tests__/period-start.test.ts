import { describe, expect, it } from 'vitest'
import { getNextPeriodStartDate } from '../planning-format'

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
