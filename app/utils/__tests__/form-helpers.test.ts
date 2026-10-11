import { describe, expect, it } from 'vitest'
import { fromDateInputValue, toDateInputValue } from '../form-helpers'

describe('toDateInputValue', () => {
  it('formats a picked Date as its local calendar day', () => {
    expect(toDateInputValue(new Date(2026, 9, 1, 0, 0, 0))).toBe('2026-10-01')
  })

  it('cuts ISO strings to the date part and keeps plain days', () => {
    expect(toDateInputValue('2026-10-09T00:00:00.000Z')).toBe('2026-10-09')
    expect(toDateInputValue('2026-10-09')).toBe('2026-10-09')
  })

  it('returns an empty string for missing or invalid values', () => {
    expect(toDateInputValue(null)).toBe('')
    expect(toDateInputValue(undefined)).toBe('')
    expect(toDateInputValue(new Date('nope'))).toBe('')
  })
})

describe('fromDateInputValue', () => {
  it('parses a day as local noon', () => {
    const date = fromDateInputValue('2026-10-09')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(9)
    expect(date?.getDate()).toBe(9)
    expect(date?.getHours()).toBe(12)
  })

  it('round-trips with toDateInputValue', () => {
    expect(toDateInputValue(fromDateInputValue('2026-09-14'))).toBe('2026-09-14')
  })

  it('returns null for empty or malformed input', () => {
    expect(fromDateInputValue('')).toBeNull()
    expect(fromDateInputValue('14.09.2026')).toBeNull()
  })
})
