import { describe, expect, it, vi } from 'vitest'

vi.mock('../prisma', () => ({ prisma: {} }))

const { planRunsPast } = await import('../envelope-lifecycle')

function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

describe('planRunsPast', () => {
  const closedAt = day(2026, 7, 1)
  const startDate = day(2026, 1, 1)

  it.each([
    ['without an end', { frequency: 'MONTHLY', startDate, endDate: null }, true],
    ['ending after the closing date', { frequency: 'MONTHLY', startDate, endDate: day(2026, 12, 31) }, true],
    ['ending on the closing date', { frequency: 'MONTHLY', startDate, endDate: closedAt }, true],
    ['ending the day before', { frequency: 'MONTHLY', startDate, endDate: day(2026, 6, 30) }, false],
    ['once, on the closing date', { frequency: 'ONCE', startDate: closedAt, endDate: null }, true],
    ['once, later', { frequency: 'ONCE', startDate: day(2026, 8, 1), endDate: null }, true],
    ['once, before the closing date', { frequency: 'ONCE', startDate: day(2026, 6, 30), endDate: null }, false],
  ] as const)('a plan %s', (_name, plan, expected) => {
    expect(planRunsPast(plan, closedAt)).toBe(expected)
  })

  it('compares whole days, not times', () => {
    expect(planRunsPast({ frequency: 'MONTHLY', startDate, endDate: day(2026, 7, 1, 0) }, day(2026, 7, 1, 18))).toBe(true)
  })
})
