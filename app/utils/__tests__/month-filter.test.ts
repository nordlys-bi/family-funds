import { describe, expect, it } from 'vitest'
import {
  currentMonthYYYYMM,
  isMonthYYYYMMFormat,
  isValidMonthYYYYMM,
  parseMonthRange,
  formatMonthLabel,
  lastNMonths,
} from '../month-filter'

describe('currentMonthYYYYMM', () => {
  it('returns YYYY-MM for a given date', () => {
    expect(currentMonthYYYYMM(new Date(2026, 6, 15))).toBe('2026-07') // Monat 6 (0-idx) = Juli
  })

  it('zero-pads the month', () => {
    expect(currentMonthYYYYMM(new Date(2026, 0, 31))).toBe('2026-01')
    expect(currentMonthYYYYMM(new Date(2026, 8, 1))).toBe('2026-09')
  })

  it('defaults to "now"', () => {
    const result = currentMonthYYYYMM()
    expect(result).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('isMonthYYYYMMFormat (regex only)', () => {
  it('accepts canonical YYYY-MM', () => {
    expect(isMonthYYYYMMFormat('2026-07')).toBe(true)
    expect(isMonthYYYYMMFormat('1999-12')).toBe(true)
  })

  it('rejects non-strings', () => {
    expect(isMonthYYYYMMFormat(2026)).toBe(false)
    expect(isMonthYYYYMMFormat(null)).toBe(false)
    expect(isMonthYYYYMMFormat(undefined)).toBe(false)
  })

  it('rejects malformed strings', () => {
    expect(isMonthYYYYMMFormat('2026/07')).toBe(false)
    expect(isMonthYYYYMMFormat('26-07')).toBe(false)
    expect(isMonthYYYYMMFormat('2026-7')).toBe(false)
    expect(isMonthYYYYMMFormat('2026-7')).toBe(false)
    expect(isMonthYYYYMMFormat('2026-13')).toBe(true) // Regex akzeptiert; Range-Check unten
  })
})

describe('isValidMonthYYYYMM (semantic)', () => {
  it('accepts valid months', () => {
    expect(isValidMonthYYYYMM('2026-01')).toBe(true)
    expect(isValidMonthYYYYMM('2026-12')).toBe(true)
  })

  it('rejects month part 00 and 13+', () => {
    expect(isValidMonthYYYYMM('2026-00')).toBe(false)
    expect(isValidMonthYYYYMM('2026-13')).toBe(false)
  })

  it('rejects out-of-range years', () => {
    expect(isValidMonthYYYYMM('1899-12')).toBe(false)
    expect(isValidMonthYYYYMM('3001-01')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isValidMonthYYYYMM('foo')).toBe(false)
    expect(isValidMonthYYYYMM('')).toBe(false)
  })
})

describe('parseMonthRange', () => {
  it('returns start=1st, end=1st of next month for mid-year', () => {
    const range = parseMonthRange('2026-05')!
    expect(range.start.getFullYear()).toBe(2026)
    expect(range.start.getMonth()).toBe(4) // Mai
    expect(range.start.getDate()).toBe(1)
    expect(range.end.getFullYear()).toBe(2026)
    expect(range.end.getMonth()).toBe(5) // Juni
    expect(range.end.getDate()).toBe(1)
  })

  it('handles year boundary: December → next January', () => {
    const range = parseMonthRange('2026-12')!
    expect(range.start.getMonth()).toBe(11)
    expect(range.end.getFullYear()).toBe(2027)
    expect(range.end.getMonth()).toBe(0) // Januar 2027
  })

  it('returns null for invalid input', () => {
    expect(parseMonthRange('foo')).toBeNull()
    expect(parseMonthRange('2026-13')).toBeNull()
  })
})

describe('formatMonthLabel', () => {
  it('formats YYYY-MM as "Month Year" in de-DE', () => {
    expect(formatMonthLabel('2026-01')).toBe('Januar 2026')
    expect(formatMonthLabel('2026-07')).toBe('Juli 2026')
    expect(formatMonthLabel('2026-12')).toBe('Dezember 2026')
  })

  it('returns the raw string for invalid input', () => {
    expect(formatMonthLabel('not-a-month')).toBe('not-a-month')
  })

  it('respects a custom locale', () => {
    expect(formatMonthLabel('2026-07', 'en-US')).toBe('July 2026')
  })
})

describe('lastNMonths', () => {
  it('returns N options newest-first', () => {
    const options = lastNMonths(3, new Date(2026, 6, 15)) // Juli 2026
    expect(options).toHaveLength(3)
    expect(options[0]).toEqual({ value: '2026-07', label: 'Juli 2026' })
    expect(options[1]).toEqual({ value: '2026-06', label: 'Juni 2026' })
    expect(options[2]).toEqual({ value: '2026-05', label: 'Mai 2026' })
  })

  it('crosses year boundary backwards', () => {
    const options = lastNMonths(3, new Date(2026, 0, 15)) // Januar 2026
    expect(options[0]).toEqual({ value: '2026-01', label: 'Januar 2026' })
    expect(options[1]).toEqual({ value: '2025-12', label: 'Dezember 2025' })
    expect(options[2]).toEqual({ value: '2025-11', label: 'November 2025' })
  })

  it('returns empty array for n=0', () => {
    expect(lastNMonths(0)).toEqual([])
  })

  it('returns 12 options by default', () => {
    const options = lastNMonths(12, new Date(2026, 6, 15))
    expect(options).toHaveLength(12)
    // Neueste zuerst, älteste zuletzt
    expect(options[0].value).toBe('2026-07')
    expect(options[11].value).toBe('2025-08')
  })
})
