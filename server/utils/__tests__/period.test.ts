import { describe, expect, it } from 'vitest'
import { addPeriod, dayKey, getMonthWindow, startOfPeriod } from '../period'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

describe('dayKey', () => {
  it('treats every time of a day as the same day', () => {
    expect(dayKey(day(2026, 11, 2, 0))).toBe(dayKey(day(2026, 11, 2, 23)))
  })
})

describe('startOfPeriod', () => {
  it('finds the start of each period type', () => {
    const date = day(2026, 11, 4)
    expect(startOfPeriod(date, 'WEEKLY')).toEqual(day(2026, 11, 2))
    expect(startOfPeriod(date, 'MONTHLY')).toEqual(day(2026, 11, 1))
    expect(startOfPeriod(date, 'QUARTERLY')).toEqual(day(2026, 10, 1))
    expect(startOfPeriod(date, 'YEARLY')).toEqual(day(2026, 1, 1))
    expect(startOfPeriod(date, 'ONCE')).toEqual(date)
  })

  it('counts a Sunday to the week of the preceding Monday', () => {
    expect(startOfPeriod(day(2026, 11, 1), 'WEEKLY')).toEqual(day(2026, 10, 26))
  })
})

describe('addPeriod', () => {
  it('moves to the next period, also across the year', () => {
    expect(addPeriod(day(2026, 12, 28), 'WEEKLY')).toEqual(day(2027, 1, 4))
    expect(addPeriod(day(2026, 12, 1), 'MONTHLY')).toEqual(day(2027, 1, 1))
    expect(addPeriod(day(2026, 10, 1), 'QUARTERLY')).toEqual(day(2027, 1, 1))
    expect(addPeriod(day(2026, 1, 1), 'YEARLY')).toEqual(day(2027, 1, 1))
  })
})

describe('getMonthWindow', () => {
  it('spans the calendar month', () => {
    expect(getMonthWindow(day(2026, 11, 15))).toEqual({ monthStart: day(2026, 11, 1), monthEnd: day(2026, 12, 1) })
  })
})
