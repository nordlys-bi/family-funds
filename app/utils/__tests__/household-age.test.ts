import { describe, expect, it } from 'vitest'
import { isFirstRun, householdAgeInDays } from '../household-age'

describe('isFirstRun', () => {
  const now = new Date('2026-07-09T12:00:00Z')

  it('returns true for a household created today', () => {
    const household = { createdAt: new Date('2026-07-09T08:00:00Z').toISOString() }
    expect(isFirstRun(household, now)).toBe(true)
  })

  it('returns true for a household created 6 days ago (within threshold)', () => {
    const household = { createdAt: new Date('2026-07-03T12:00:00Z').toISOString() }
    expect(isFirstRun(household, now)).toBe(true)
  })

  it('returns false for a household created exactly 7 days ago (boundary)', () => {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const household = { createdAt: sevenDaysAgo.toISOString() }
    expect(isFirstRun(household, now)).toBe(false)
  })

  it('returns false for a household created 30 days ago (established)', () => {
    const household = { createdAt: new Date('2026-06-09T12:00:00Z').toISOString() }
    expect(isFirstRun(household, now)).toBe(false)
  })

  it('returns true for a household created in the future (clock drift safe)', () => {
    const futureHousehold = { createdAt: new Date('2026-07-10T12:00:00Z').toISOString() }
    expect(isFirstRun(futureHousehold, now)).toBe(true)
  })

  it('returns false for null/undefined household (defensive)', () => {
    expect(isFirstRun(null, now)).toBe(false)
    expect(isFirstRun(undefined, now)).toBe(false)
  })

  it('returns false for household with missing createdAt', () => {
    expect(isFirstRun({}, now)).toBe(false)
  })

  it('returns false for malformed createdAt', () => {
    expect(isFirstRun({ createdAt: 'not-a-date' }, now)).toBe(false)
  })

  it('respects a custom threshold', () => {
    const household = { createdAt: new Date('2026-06-25T12:00:00Z').toISOString() } // 14 days ago
    expect(isFirstRun(household, now, 30)).toBe(true) // 30-day threshold
    expect(isFirstRun(household, now, 7)).toBe(false) // 7-day threshold
  })
})

describe('householdAgeInDays', () => {
  const now = new Date('2026-07-09T12:00:00Z')

  it('returns 0 for a household created today', () => {
    const household = { createdAt: new Date('2026-07-09T12:00:00Z').toISOString() }
    expect(householdAgeInDays(household, now)).toBe(0)
  })

  it('returns the floor of full days for older households', () => {
    const household = { createdAt: new Date('2026-07-05T18:00:00Z').toISOString() } // 3.75 days ago
    expect(householdAgeInDays(household, now)).toBe(3)
  })

  it('returns -1 for missing or invalid household', () => {
    expect(householdAgeInDays(null, now)).toBe(-1)
    expect(householdAgeInDays(undefined, now)).toBe(-1)
    expect(householdAgeInDays({}, now)).toBe(-1)
    expect(householdAgeInDays({ createdAt: 'broken' }, now)).toBe(-1)
  })
})
