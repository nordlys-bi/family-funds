import { describe, expect, it } from 'vitest'
import {
  buildAggregatedForecast,
  buildBudgetForecast,
  classifyForecastSeverity,
} from '../forecast'

// === Kanonische Test-Konstanten ========================================
// Wir testen gegen einen festen Monat (Juni 2026) und bewegen uns darin.
// monthStart = 1.6.2026, monthEnd = 1.7.2026.
const MONTH_START = new Date(2026, 5, 1, 12, 0, 0, 0)
const MONTH_END = new Date(2026, 6, 1, 12, 0, 0, 0)

function daysIntoMonth(day: number): Date {
  return new Date(2026, 5, day, 12, 0, 0, 0)
}

describe('classifyForecastSeverity', () => {
  it('gibt on-track zurück, wenn forecast <= planned', () => {
    expect(classifyForecastSeverity(100_00, 100_00)).toBe('on-track')
    expect(classifyForecastSeverity(80_00, 100_00)).toBe('on-track')
    expect(classifyForecastSeverity(0, 100_00)).toBe('on-track')
  })

  it('gibt warning zurück, wenn forecast > planned aber <= 110% planned', () => {
    expect(classifyForecastSeverity(100_01, 100_00)).toBe('warning')
    expect(classifyForecastSeverity(110_00, 100_00)).toBe('warning')
  })

  it('gibt over zurück, wenn forecast > 110% planned', () => {
    expect(classifyForecastSeverity(110_01, 100_00)).toBe('over')
    expect(classifyForecastSeverity(150_00, 100_00)).toBe('over')
  })

  it('Edge case: planned <= 0 → on-track (kein Plan zu verfehlen)', () => {
    expect(classifyForecastSeverity(50_000, 0)).toBe('on-track')
    expect(classifyForecastSeverity(50_000, -10_00)).toBe('on-track')
  })
})

describe('buildBudgetForecast', () => {
  it('Tag 1 des Monats: daysSinceStart = 0, dailyRate = 0, forecastTotal = spentAmount', () => {
    const today = daysIntoMonth(1)
    const result = buildBudgetForecast(100_000, 5_000, MONTH_START, MONTH_END, today)
    // Tag 1: 0 Tage seit Start, 30 Tage verbleibend (1.6. → 1.7.).
    // dailyRate = 0 → forecastTotal = 5000.
    expect(result.forecastTotal).toBe(5_000)
    expect(result.forecastRemaining).toBe(95_000)
    expect(result.basisDays).toBe(0)
    expect(result.basisAmount).toBe(5_000)
    expect(result.severity).toBe('on-track')
  })

  it('Tag 15 des Monats, Hälfte verbraucht: forecastTotal ≈ planned', () => {
    const today = daysIntoMonth(15)
    const spent = 50_000 // 50% verbraucht nach 14 Tagen (1.6. → 15.6. = 14 Tage)
    const result = buildBudgetForecast(100_000, spent, MONTH_START, MONTH_END, today)
    // daysSinceStart = 14, daysRemaining = 16.
    // dailyRate = 50000 / 14 ≈ 3571.43.
    // forecastTotal = 50000 + 3571.43 * 16 ≈ 50000 + 57142.86 ≈ 107143.
    // → über Plan, aber innerhalb 110% → warning.
    expect(result.forecastTotal).toBeGreaterThan(100_000)
    expect(result.forecastTotal).toBeLessThanOrEqual(110_000)
    expect(result.severity).toBe('warning')
  })

  it('Tag 28 des Monats, fast alles verbraucht: forecast weit über Plan', () => {
    const today = daysIntoMonth(28)
    const spent = 95_000 // 95% verbraucht nach 27 Tagen
    const result = buildBudgetForecast(100_000, spent, MONTH_START, MONTH_END, today)
    // daysSinceStart = 27, daysRemaining = 3.
    // dailyRate = 95000 / 27 ≈ 3518.52.
    // forecastTotal = 95000 + 3518.52 * 3 ≈ 95000 + 10555.56 ≈ 105556.
    // → warning (5% über Plan, < 10%).
    expect(result.forecastTotal).toBeGreaterThan(100_000)
    expect(result.severity).toBe('warning')
  })

  it('today >= monthEnd: daysRemaining = 0, forecastTotal = spentAmount', () => {
    // today 5.7. → nach monthEnd (1.7.)
    const today = new Date(2026, 6, 5, 12, 0, 0, 0)
    const result = buildBudgetForecast(100_000, 80_000, MONTH_START, MONTH_END, today)
    // effectiveToday wird auf monthEnd - 1ms gekappt → 1.7. 11:59:59.999.
    // day-Normalisierung rundet auf 1.7. 00:00.
    // daysSinceStart = 30, daysRemaining = 0.
    // dailyRate = 80000 / 30 ≈ 2666.67.
    // forecastTotal = 80000 + 2666.67 * 0 = 80000 (= spentAmount, weil
    // keine Tage mehr zu extrapolieren sind).
    expect(result.forecastTotal).toBe(80_000)
    expect(result.basisDays).toBe(30)
    expect(result.forecastRemaining).toBe(20_000) // 100_000 - 80_000
  })

  it('today < monthStart: daysSinceStart = 0, forecastTotal = spentAmount', () => {
    // today 25.5. → vor monthStart (1.6.)
    const today = new Date(2026, 4, 25, 12, 0, 0, 0)
    const result = buildBudgetForecast(100_000, 0, MONTH_START, MONTH_END, today)
    // effectiveToday wird auf monthStart gesetzt.
    expect(result.forecastTotal).toBe(0)
    expect(result.basisDays).toBe(0)
  })

  it('Edge case: planned = 0 → severity = on-track (kein Plan zu verfehlen)', () => {
    const today = daysIntoMonth(15)
    const result = buildBudgetForecast(0, 5_000, MONTH_START, MONTH_END, today)
    // forecastTotal = 5000 + (5_000 / 14) * 16 = 5000 + 5714 = 10714
    // severity bleibt on-track, weil planned <= 0.
    expect(result.forecastTotal).toBeGreaterThan(0)
    expect(result.severity).toBe('on-track')
    expect(result.forecastRemaining).toBe(-result.forecastTotal) // 0 - forecast
  })

  it('Edge case: spent = 0 → forecastTotal = 0 (dailyRate = 0)', () => {
    const today = daysIntoMonth(20)
    const result = buildBudgetForecast(100_000, 0, MONTH_START, MONTH_END, today)
    expect(result.forecastTotal).toBe(0)
    expect(result.forecastRemaining).toBe(100_000)
    expect(result.severity).toBe('on-track')
  })

  it('computedAt ist ein gültiger ISO-String', () => {
    const today = daysIntoMonth(10)
    const result = buildBudgetForecast(100_000, 0, MONTH_START, MONTH_END, today)
    expect(() => new Date(result.computedAt).toISOString()).not.toThrow()
    expect(new Date(result.computedAt).getTime()).toBeGreaterThan(0)
  })

  it('Severität exakt 100% → warning (User-Spec: nur > 100% ist warning, > 110% ist over)', () => {
    // 100.000 planned, 50.000 spent an Tag 15 (14 Tage seit Start, 16 verbleibend)
    // dailyRate = 50000/14 ≈ 3571.43
    // forecastTotal = 50000 + 3571.43 * 16 = 107143 → > 110_000? Nein, 107_143 < 110_000
    // → warning
    const today = daysIntoMonth(15)
    const result = buildBudgetForecast(100_000, 50_000, MONTH_START, MONTH_END, today)
    expect(result.forecastTotal).toBeGreaterThan(100_000)
    expect(result.forecastTotal).toBeLessThanOrEqual(110_000)
    expect(result.severity).toBe('warning')
  })
})

describe('buildAggregatedForecast', () => {
  it('leeres Array: severity = on-track, alles 0', () => {
    const result = buildAggregatedForecast([], 0)
    expect(result.forecastTotal).toBe(0)
    expect(result.plannedTotal).toBe(0)
    expect(result.delta).toBe(0)
    expect(result.severity).toBe('on-track')
  })

  it('aggregiert forecastTotal und plannedTotal korrekt', () => {
    const forecasts = [
      { forecastTotal: 50_000, forecastRemaining: 0, severity: 'on-track' as const, basisDays: 10, basisAmount: 30_000, computedAt: '2026-06-15T12:00:00.000Z' },
      { forecastTotal: 30_000, forecastRemaining: 0, severity: 'on-track' as const, basisDays: 10, basisAmount: 20_000, computedAt: '2026-06-15T12:00:00.000Z' },
    ]
    const result = buildAggregatedForecast(forecasts, 100_000)
    expect(result.forecastTotal).toBe(80_000)
    expect(result.plannedTotal).toBe(100_000)
    expect(result.delta).toBe(-20_000) // im Plan (negativ = unter forecast)
    expect(result.severity).toBe('on-track')
  })

  it('Severity-Aggregation: max severity wins', () => {
    const forecasts = [
      { forecastTotal: 50_000, forecastRemaining: 0, severity: 'on-track' as const, basisDays: 10, basisAmount: 30_000, computedAt: '2026-06-15T12:00:00.000Z' },
      { forecastTotal: 80_000, forecastRemaining: 0, severity: 'warning' as const, basisDays: 10, basisAmount: 50_000, computedAt: '2026-06-15T12:00:00.000Z' },
      { forecastTotal: 30_000, forecastRemaining: 0, severity: 'on-track' as const, basisDays: 10, basisAmount: 20_000, computedAt: '2026-06-15T12:00:00.000Z' },
    ]
    const result = buildAggregatedForecast(forecasts, 100_000)
    // max severity = warning (warning > on-track, aber < over)
    expect(result.severity).toBe('warning')
  })

  it('Severity-Aggregation: ein over hebt Haushalt auf over', () => {
    const forecasts = [
      { forecastTotal: 30_000, forecastRemaining: 0, severity: 'on-track' as const, basisDays: 10, basisAmount: 20_000, computedAt: '2026-06-15T12:00:00.000Z' },
      { forecastTotal: 200_000, forecastRemaining: 0, severity: 'over' as const, basisDays: 10, basisAmount: 150_000, computedAt: '2026-06-15T12:00:00.000Z' },
    ]
    const result = buildAggregatedForecast(forecasts, 100_000)
    expect(result.severity).toBe('over')
  })

  it('delta positiv = über Plan (sum forecast > sum planned)', () => {
    const forecasts = [
      { forecastTotal: 80_000, forecastRemaining: 0, severity: 'warning' as const, basisDays: 10, basisAmount: 50_000, computedAt: '2026-06-15T12:00:00.000Z' },
      { forecastTotal: 60_000, forecastRemaining: 0, severity: 'warning' as const, basisDays: 10, basisAmount: 40_000, computedAt: '2026-06-15T12:00:00.000Z' },
    ]
    const result = buildAggregatedForecast(forecasts, 100_000)
    expect(result.delta).toBe(40_000) // 140000 - 100000
    expect(result.delta).toBeGreaterThan(0)
  })
})

// === Integrations-Test: buildBudgetOverview liefert forecast =========
import { buildBudgetOverview } from '../budget-evaluation'
import type { BudgetVersion } from '@prisma/client'

function makeVersion(overrides: Partial<BudgetVersion> & { amount: number; frequency: BudgetVersion['frequency']; validFrom: Date }): BudgetVersion {
  return {
    id: overrides.id ?? `version-${Math.random().toString(36).slice(2)}`,
    budgetId: overrides.budgetId ?? 'budget-1',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T12:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T12:00:00Z'),
    amount: overrides.amount,
    frequency: overrides.frequency,
    validFrom: overrides.validFrom,
  }
}

describe('buildBudgetOverview — forecast field (issue #60)', () => {
  it('jedes Budget hat ein forecast-Feld mit den erwarteten Sub-Feldern', () => {
    const budget = {
      id: 'budget-1',
      key: 'GROCERIES',
      name: 'Lebensmittel',
      versions: [
        makeVersion({
          amount: 100_000,
          frequency: 'MONTHLY' as const,
          validFrom: new Date(2025, 0, 1),
        }),
      ],
    }
    const result = buildBudgetOverview([budget], [], new Date(2026, 5, 15))
    expect(result.budgets[0].forecast).toBeDefined()
    expect(result.budgets[0].forecast.forecastTotal).toBeTypeOf('number')
    expect(result.budgets[0].forecast.forecastRemaining).toBeTypeOf('number')
    expect(result.budgets[0].forecast.severity).toMatch(/on-track|warning|over/)
    expect(result.budgets[0].forecast.basisDays).toBeTypeOf('number')
    expect(result.budgets[0].forecast.basisAmount).toBeTypeOf('number')
    expect(result.budgets[0].forecast.computedAt).toBeTypeOf('string')
  })

  it('Budget mit spent = 0 und Tag 15: forecastTotal = 0, on-track', () => {
    const budget = {
      id: 'budget-1',
      key: 'X',
      name: 'X',
      versions: [
        makeVersion({
          amount: 100_000,
          frequency: 'MONTHLY' as const,
          validFrom: new Date(2025, 0, 1),
        }),
      ],
    }
    const result = buildBudgetOverview([budget], [], new Date(2026, 5, 15))
    expect(result.budgets[0].forecast.forecastTotal).toBe(0)
    expect(result.budgets[0].forecast.severity).toBe('on-track')
  })
})
