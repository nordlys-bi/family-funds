import { describe, expect, it } from 'vitest'
import { createError } from 'h3'
import {
  assertFrequency,
  assertPeriodStart,
  assertPlanningKind,
  frequencies,
  generateBudgetKey,
  isPeriodStart,
  parseDateInput,
  parseMoneyToCents,
  parseOptionalDateInput,
  planningKinds,
} from '../planning'

// Helper to assert that running `fn` throws an H3 400 with the expected message.
function expectBadRequest(fn: () => unknown, message: string | RegExp): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(Error)
  const h3Error = caught as ReturnType<typeof createError>
  expect(h3Error.statusCode).toBe(400)
  expect(h3Error.statusMessage).toMatch(message)
}

describe('planningKinds / assertPlanningKind', () => {
  it('exposes the four canonical kinds', () => {
    expect(planningKinds).toEqual(['budget', 'incomePlan', 'fixedCostPlan', 'savingsGoal'])
  })

  it('returns valid kinds unchanged', () => {
    for (const kind of planningKinds) {
      expect(assertPlanningKind(kind)).toBe(kind)
    }
  })

  it('throws 400 on unknown strings', () => {
    expectBadRequest(
      () => assertPlanningKind('expense'),
      /Invalid planning kind/,
    )
  })

  it('throws 400 on non-string values', () => {
    expectBadRequest(() => assertPlanningKind(42), /Invalid planning kind/)
    expectBadRequest(() => assertPlanningKind(null), /Invalid planning kind/)
    expectBadRequest(() => assertPlanningKind(undefined), /Invalid planning kind/)
  })
})

describe('assertFrequency', () => {
  it('accepts every canonical frequency', () => {
    expect(frequencies).toEqual(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'])
    for (const f of frequencies) {
      expect(assertFrequency(f)).toBe(f)
    }
  })

  it('throws 400 on bogus values', () => {
    expectBadRequest(() => assertFrequency('DAILY'), /Invalid frequency/)
    expectBadRequest(() => assertFrequency(''), /Invalid frequency/)
    expectBadRequest(() => assertFrequency(1), /Invalid frequency/)
  })
})

describe('parseMoneyToCents', () => {
  describe('numeric inputs', () => {
    it('converts positive numbers to cents', () => {
      expect(parseMoneyToCents(10, 'amount')).toBe(1000)
      expect(parseMoneyToCents(10.5, 'amount')).toBe(1050)
      expect(parseMoneyToCents(0.01, 'amount')).toBe(1)
      expect(parseMoneyToCents(1234.567, 'amount')).toBe(123457) // rounds to nearest cent
    })

    it('rejects zero, negative, and non-finite numbers', () => {
      expectBadRequest(() => parseMoneyToCents(0, 'amount'), /positive amount/)
      expectBadRequest(() => parseMoneyToCents(-1, 'amount'), /positive amount/)
      expectBadRequest(() => parseMoneyToCents(Number.NaN, 'amount'), /positive amount/)
      expectBadRequest(() => parseMoneyToCents(Number.POSITIVE_INFINITY, 'amount'), /positive amount/)
    })
  })

  describe('string inputs', () => {
    it('parses German decimal format with comma', () => {
      expect(parseMoneyToCents('10,50', 'amount')).toBe(1050)
      expect(parseMoneyToCents('10', 'amount')).toBe(1000)
      expect(parseMoneyToCents('0,99', 'amount')).toBe(99)
    })

    it('parses US decimal format with dot', () => {
      expect(parseMoneyToCents('10.50', 'amount')).toBe(1050)
      expect(parseMoneyToCents('10', 'amount')).toBe(1000)
    })

    it('parses German thousands + decimal (1.234,56)', () => {
      expect(parseMoneyToCents('1.234,56', 'amount')).toBe(123456)
      expect(parseMoneyToCents('1.000.000,00', 'amount')).toBe(100000000)
    })

    it('parses US thousands + decimal (1,234.56)', () => {
      expect(parseMoneyToCents('1,234.56', 'amount')).toBe(123456)
      expect(parseMoneyToCents('1,000,000.00', 'amount')).toBe(100000000)
    })

    it('treats a single comma as decimal separator', () => {
      expect(parseMoneyToCents('1234,56', 'amount')).toBe(123456)
    })

    it('treats a single dot as decimal separator', () => {
      expect(parseMoneyToCents('1234.56', 'amount')).toBe(123456)
    })

    it('documented quirk: a comma-only input like "1,234" is read as 1.234 (€1.23), not 1234', () => {
      // Single comma is always interpreted as decimal separator, even when there are
      // 3 digits after it. This matches the existing implementation behaviour.
      // Use "1.234,56" or "1.234" if you mean one thousand two hundred thirty-four.
      expect(parseMoneyToCents('1,234', 'amount')).toBe(123)
    })

    it('strips whitespace and invisible chars', () => {
      expect(parseMoneyToCents('1 234,56', 'amount')).toBe(123456)
      expect(parseMoneyToCents('  10.50  ', 'amount')).toBe(1050)
    })

    it('rejects garbage and non-positive values', () => {
      expectBadRequest(() => parseMoneyToCents('abc', 'amount'), /positive amount/)
      expectBadRequest(() => parseMoneyToCents('', 'amount'), /required/)
      expectBadRequest(() => parseMoneyToCents('-5', 'amount'), /positive amount/)
      expectBadRequest(() => parseMoneyToCents('0', 'amount'), /positive amount/)
    })

    it('rejects non-string, non-number values', () => {
      expectBadRequest(() => parseMoneyToCents(null, 'amount'), /required/)
      expectBadRequest(() => parseMoneyToCents(undefined, 'amount'), /required/)
      expectBadRequest(() => parseMoneyToCents({}, 'amount'), /required/)
    })

    it('uses the provided field name in error messages', () => {
      try {
        parseMoneyToCents('x', 'monthlyRate')
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as any).statusMessage).toMatch(/monthlyRate/)
      }
    })
  })
})

describe('parseDateInput', () => {
  it('parses ISO-ish date strings', () => {
    const date = parseDateInput('2026-06-15', 'validFrom')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(5) // June
    expect(date.getDate()).toBe(15)
    // Anchored to 12:00 local time so DST shifts don't move the day.
    expect(date.getHours()).toBe(12)
  })

  it('throws on empty / non-string input', () => {
    expectBadRequest(() => parseDateInput('', 'validFrom'), /required/)
    expectBadRequest(() => parseDateInput(null, 'validFrom'), /required/)
    expectBadRequest(() => parseDateInput(123, 'validFrom'), /required/)
  })

  it('throws on unparseable strings', () => {
    expectBadRequest(() => parseDateInput('not-a-date', 'validFrom'), /invalid/)
  })
})

describe('parseOptionalDateInput', () => {
  it('returns null for empty / null / undefined', () => {
    expect(parseOptionalDateInput(null)).toBeNull()
    expect(parseOptionalDateInput(undefined)).toBeNull()
    expect(parseOptionalDateInput('')).toBeNull()
  })

  it('delegates to parseDateInput for valid strings', () => {
    const date = parseOptionalDateInput('2026-01-01')
    expect(date).toBeInstanceOf(Date)
    expect(date?.getFullYear()).toBe(2026)
  })

  it('rejects non-string, non-null values', () => {
    expectBadRequest(() => parseOptionalDateInput(42), /Invalid date/)
  })
})

describe('isPeriodStart / assertPeriodStart', () => {
  it('WEEKLY: only Monday is a valid start', () => {
    // 2026-06-15 is a Monday
    const monday = new Date(2026, 5, 15, 12)
    const tuesday = new Date(2026, 5, 16, 12)
    const sunday = new Date(2026, 5, 14, 12)
    expect(isPeriodStart(monday, 'WEEKLY')).toBe(true)
    expect(isPeriodStart(tuesday, 'WEEKLY')).toBe(false)
    expect(isPeriodStart(sunday, 'WEEKLY')).toBe(false)
  })

  it('MONTHLY: only the 1st of a month', () => {
    expect(isPeriodStart(new Date(2026, 5, 1, 12), 'MONTHLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 5, 15, 12), 'MONTHLY')).toBe(false)
    // Use July 31 to test "last day of a 31-day month is not a period start".
    // June 31 doesn't work because JS rolls it over to July 1 (a valid start).
    expect(isPeriodStart(new Date(2026, 6, 31, 12), 'MONTHLY')).toBe(false)
  })

  it('QUARTERLY: 1st of Jan/Apr/Jul/Oct', () => {
    expect(isPeriodStart(new Date(2026, 0, 1, 12), 'QUARTERLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 3, 1, 12), 'QUARTERLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 6, 1, 12), 'QUARTERLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 9, 1, 12), 'QUARTERLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 1, 1, 12), 'QUARTERLY')).toBe(false)
    expect(isPeriodStart(new Date(2026, 0, 15, 12), 'QUARTERLY')).toBe(false)
  })

  it('YEARLY: only Jan 1st', () => {
    expect(isPeriodStart(new Date(2026, 0, 1, 12), 'YEARLY')).toBe(true)
    expect(isPeriodStart(new Date(2026, 0, 2, 12), 'YEARLY')).toBe(false)
    expect(isPeriodStart(new Date(2026, 1, 1, 12), 'YEARLY')).toBe(false)
  })

  it('ONCE: every date is a valid start', () => {
    expect(isPeriodStart(new Date(2026, 5, 17, 12), 'ONCE')).toBe(true)
    expect(isPeriodStart(new Date(2026, 11, 31, 12), 'ONCE')).toBe(true)
  })

  it('assertPeriodStart throws on misalignment', () => {
    // 2026-06-16 is a Tuesday, not a Monday — so it's an invalid WEEKLY start.
    expectBadRequest(
      () => assertPeriodStart(new Date(2026, 5, 16, 12), 'WEEKLY'),
      /match the start of the selected period/,
    )
  })

  it('assertPeriodStart accepts aligned dates silently', () => {
    expect(() =>
      assertPeriodStart(new Date(2026, 5, 1, 12), 'MONTHLY'),
    ).not.toThrow()
  })

  it('uses the provided field name in the error message', () => {
    try {
      assertPeriodStart(new Date(2026, 5, 15, 12), 'MONTHLY', 'startDate')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as any).statusMessage).toMatch(/startDate/)
    }
  })
})

describe('generateBudgetKey', () => {
  it('produces budget_<uuid-without-dashes>', () => {
    const key = generateBudgetKey()
    expect(key).toMatch(/^budget_[a-f0-9]{32}$/)
  })

  it('returns a unique value on each call', () => {
    const keys = new Set(Array.from({ length: 25 }, generateBudgetKey))
    expect(keys.size).toBe(25)
  })
})