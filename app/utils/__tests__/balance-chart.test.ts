import { describe, expect, it } from 'vitest'
import {
  balanceAxisTicks,
  balanceDomain,
  buildBalanceChartGeometry,
  buildSparklineGeometry,
  buildStepAreaPath,
  buildStepPath,
  compactMoneyLabel,
  dayNumber,
} from '../balance-chart'

describe('dayNumber', () => {
  it('counts calendar days independent of DST', () => {
    // Zeitumstellung Ende Oktober: trotzdem genau ein Tag Abstand
    expect(dayNumber('2026-10-26') - dayNumber('2026-10-25')).toBe(1)
    expect(dayNumber('2026-10-01') - dayNumber('2026-09-01')).toBe(30)
  })
})

describe('balanceDomain', () => {
  it('always includes zero', () => {
    expect(balanceDomain([5000, 10000], 0)).toEqual({ min: 0, max: 10000 })
    expect(balanceDomain([-3000, -1000], 0)).toEqual({ min: -3000, max: 0 })
  })

  it('adds headroom only on the sides away from zero', () => {
    expect(balanceDomain([-1000, 1000], 0.1)).toEqual({ min: -1200, max: 1200 })
    expect(balanceDomain([1000], 0.1)).toEqual({ min: 0, max: 1100 })
  })

  it('gives a flat zero line a non-empty range', () => {
    const domain = balanceDomain([0, 0])
    expect(domain.max).toBeGreaterThan(domain.min)
  })
})

describe('buildStepPath', () => {
  it('draws horizontal then vertical segments (step-after)', () => {
    expect(buildStepPath([{ x: 0, y: 10 }, { x: 5, y: 4 }, { x: 8, y: 4 }])).toBe('M0 10 H5 V4 H8')
  })

  it('draws a vertical jump for two points on the same day', () => {
    expect(buildStepPath([{ x: 0, y: 10 }, { x: 0, y: 2 }, { x: 4, y: 2 }])).toBe('M0 10 V2 H4')
  })

  it('returns an empty path without points', () => {
    expect(buildStepPath([])).toBe('')
  })
})

describe('buildStepAreaPath', () => {
  it('closes the step line against the baseline', () => {
    expect(buildStepAreaPath([{ x: 0, y: 10 }, { x: 5, y: 4 }], 20)).toBe('M0 20 V10 H5 V4 V20 Z')
  })
})

describe('buildBalanceChartGeometry', () => {
  const geometry = buildBalanceChartGeometry({
    points: [
      { date: '2026-09-01', balance: 0 },
      { date: '2026-09-01', balance: 10000 },
      { date: '2026-09-11', balance: -10000 },
    ],
    width: 120,
    height: 100,
    padding: { top: 0, right: 10, bottom: 0, left: 10 },
  })

  it('maps the date range onto the plot width', () => {
    expect(geometry.xOfDate('2026-09-01')).toBe(10)
    expect(geometry.xOfDate('2026-09-11')).toBe(110)
    expect(geometry.xOfDate('2026-09-06')).toBe(60)
  })

  it('puts zero in the middle of a symmetric domain', () => {
    expect(geometry.zeroY).toBe(50)
    expect(geometry.yOfValue(geometry.domain.max)).toBe(0)
    expect(geometry.yOfValue(geometry.domain.min)).toBe(100)
  })

  it('builds line and area paths from the coordinates', () => {
    expect(geometry.coords).toHaveLength(3)
    expect(geometry.linePath.startsWith('M10 50')).toBe(true)
    expect(geometry.areaPath.endsWith('V50 Z')).toBe(true)
  })

  it('uses an explicit range for the x axis', () => {
    const ranged = buildBalanceChartGeometry({
      points: [{ date: '2026-09-06', balance: 100 }],
      width: 100,
      height: 50,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      range: { from: '2026-09-01', to: '2026-09-11' },
    })
    expect(ranged.coords[0]!.x).toBe(50)
  })
})

describe('buildSparklineGeometry', () => {
  it('spreads values evenly across the width', () => {
    const sparkline = buildSparklineGeometry([100, 200, -100], 100, 20, 0)
    expect(sparkline.coords.map((coord) => coord.x)).toEqual([0, 50, 100])
    expect(sparkline.hasNegative).toBe(true)
    expect(sparkline.zeroY).toBeGreaterThan(0)
    expect(sparkline.zeroY).toBeLessThan(20)
  })

  it('handles a single value', () => {
    const sparkline = buildSparklineGeometry([500], 60, 20)
    expect(sparkline.coords).toHaveLength(1)
    expect(sparkline.linePath).toMatch(/^M/)
  })
})

describe('balanceAxisTicks', () => {
  it('returns round ticks including zero', () => {
    const ticks = balanceAxisTicks({ min: -25000, max: 30000 })
    expect(ticks).toContain(0)
    expect(ticks.every((tick) => tick % 1000 === 0)).toBe(true)
    expect(ticks).toEqual([-20000, 0, 20000])
  })
})

describe('compactMoneyLabel', () => {
  it('drops zero cents in German and English formats', () => {
    expect(compactMoneyLabel('1.000,00 €')).toBe('1.000 €')
    expect(compactMoneyLabel('-250,00 €')).toBe('-250 €')
    expect(compactMoneyLabel('$1,000.00')).toBe('$1,000')
  })

  it('keeps non-zero cents', () => {
    expect(compactMoneyLabel('12,50 €')).toBe('12,50 €')
  })
})
