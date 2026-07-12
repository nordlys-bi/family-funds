import { describe, expect, it } from 'vitest'
import {
  buildSavingsMonthlyProgress,
  formatMonthKey,
  getMonthWindowForOffset,
} from '../savings-progress'

/**
 * Tests fuer `savings-progress.ts` (issue #56).
 *
 * Coverage:
 *  - getMonthWindowForOffset: Monatsfenster fuer offset=0/-1/-2
 *    und Year-Rollover (Dezember -> Januar)
 *  - formatMonthKey: YYYY-MM-Format mit fuehrender Null
 *  - buildSavingsMonthlyProgress: Standardfall (3 Monate, latest
 *    first), Filterung der Executions auf den jeweiligen Monat,
 *    planned=0 / negative rate / leere Executions, percentUsed-
 *    Capping bei actual > planned
 *  - Reihenfolge: neueste zuerst
 */

const NOW = new Date(2026, 5, 17, 14, 30) // 17. Juni 2026, 14:30 lokal

describe('getMonthWindowForOffset', () => {
  it('offset=0 liefert den aktuellen Monat (1. – 1. des naechsten)', () => {
    const { monthStart, monthEnd } = getMonthWindowForOffset(0, NOW)
    expect(monthStart.getFullYear()).toBe(2026)
    expect(monthStart.getMonth()).toBe(5) // Juni (0-indexed)
    expect(monthStart.getDate()).toBe(1)
    expect(monthStart.getHours()).toBe(12) // 12:00-Anker
    expect(monthEnd.getFullYear()).toBe(2026)
    expect(monthEnd.getMonth()).toBe(6) // Juli
    expect(monthEnd.getDate()).toBe(1)
  })

  it('offset=1 liefert den Vormonat', () => {
    const { monthStart } = getMonthWindowForOffset(1, NOW)
    expect(monthStart.getFullYear()).toBe(2026)
    expect(monthStart.getMonth()).toBe(4) // Mai
  })

  it('offset=2 ueberschreitet den Jahreswechsel (Dez -> Okt)', () => {
    const dec = new Date(2026, 11, 15, 12) // Dezember 2026
    const { monthStart } = getMonthWindowForOffset(2, dec)
    expect(monthStart.getFullYear()).toBe(2026)
    expect(monthStart.getMonth()).toBe(9) // Oktober
  })

  it('offset=3 vom Januar landet im Oktober des Vorjahres', () => {
    const jan = new Date(2026, 0, 15, 12) // Januar 2026
    const { monthStart } = getMonthWindowForOffset(3, jan)
    expect(monthStart.getFullYear()).toBe(2025)
    expect(monthStart.getMonth()).toBe(9) // Oktober
  })

  it('wirft bei negativem offset (defensive)', () => {
    expect(() => getMonthWindowForOffset(-1, NOW)).toThrow(/offset must be >= 0/)
  })
})

describe('formatMonthKey', () => {
  it('formatiert Monate < 10 mit fuehrender Null', () => {
    expect(formatMonthKey(new Date(2026, 0, 15))).toBe('2026-01')
    expect(formatMonthKey(new Date(2026, 8, 1))).toBe('2026-09')
  })

  it('formatiert Monate >= 10 ohne fuehrende Null', () => {
    expect(formatMonthKey(new Date(2026, 10, 1))).toBe('2026-11')
  })
})

describe('buildSavingsMonthlyProgress — Standardfall', () => {
  it('liefert 3 Eintraege in der Reihenfolge current, -1, -2', () => {
    const goal = { monthlyRate: 5000, executions: [] }
    const result = buildSavingsMonthlyProgress(goal, 3, NOW)
    expect(result).toHaveLength(3)
    expect(result[0].month).toBe('2026-06') // current
    expect(result[1].month).toBe('2026-05')
    expect(result[2].month).toBe('2026-04')
  })

  it('propagiert planned aus monthlyRate', () => {
    const goal = { monthlyRate: 5000, executions: [] }
    const result = buildSavingsMonthlyProgress(goal, 3, NOW)
    for (const item of result) {
      expect(item.planned).toBe(5000)
    }
  })

  it('summiert nur Executions im jeweiligen Monatsfenster', () => {
    // Hinweis: Server speichert execution.date als noon local time
    // (parseDateInput in planning.ts: 'T12:00:00'). Tests muessen das
    // matchen, sonst landet eine "April 1 00:00"-Execution im Vormonat.
    const goal = {
      monthlyRate: 5000,
      executions: [
        { amount: 2000, date: new Date(2026, 5, 5, 12) },  // Juni
        { amount: 3000, date: new Date(2026, 5, 20, 12) },  // Juni
        { amount: 4000, date: new Date(2026, 4, 10, 12) },  // Mai
        { amount: 1500, date: new Date(2026, 3, 15, 12) },  // April
        { amount: 9999, date: new Date(2026, 2, 1, 12) },   // Maerz (out of window)
      ],
    }
    const result = buildSavingsMonthlyProgress(goal, 3, NOW)
    expect(result[0]).toEqual({
      month: '2026-06',
      planned: 5000,
      actual: 5000, // 2000 + 3000
      percentUsed: 100,
    })
    expect(result[1]).toEqual({
      month: '2026-05',
      planned: 5000,
      actual: 4000,
      percentUsed: 80,
    })
    expect(result[2]).toEqual({
      month: '2026-04',
      planned: 5000,
      actual: 1500,
      percentUsed: 30,
    })
  })

  it('akzeptiert String-Dates (von JSON / Prisma serialisiert)', () => {
    const goal = {
      monthlyRate: 5000,
      executions: [
        { amount: 2000, date: '2026-06-05T12:00:00.000Z' },
      ],
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result[0].actual).toBe(2000)
  })
})

describe('buildSavingsMonthlyProgress — Edge Cases', () => {
  it('planned=0 -> percentUsed=0 (Plan-Vergleich nicht moeglich)', () => {
    const goal = {
      monthlyRate: 0,
      executions: [{ amount: 1000, date: new Date(2026, 5, 10, 12) }],
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result[0].planned).toBe(0)
    expect(result[0].actual).toBe(1000)
    expect(result[0].percentUsed).toBe(0)
  })

  it('negative rate -> percentUsed=0 (Frontend blendet Plan-Vergleich aus)', () => {
    const goal = {
      monthlyRate: -1000,
      executions: [{ amount: 500, date: new Date(2026, 5, 10, 12) }],
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result[0].planned).toBe(-1000)
    expect(result[0].actual).toBe(500)
    expect(result[0].percentUsed).toBe(0)
  })

  it('leere executions -> actual=0, percentUsed=0', () => {
    const goal = { monthlyRate: 5000, executions: [] }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result[0].actual).toBe(0)
    expect(result[0].percentUsed).toBe(0)
  })

  it('actual > planned wird auf 999 gedeckelt (Infinity-Schutz)', () => {
    const goal = {
      monthlyRate: 1000, // 10 €
      executions: [{ amount: 100000, date: new Date(2026, 5, 10, 12) }], // 1000 €
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result[0].percentUsed).toBe(999)
  })

  it('ignoriert ungueltige (NaN) Execution-Dates ohne Crash', () => {
    const goal = {
      monthlyRate: 5000,
      executions: [
        { amount: 999, date: 'not-a-date' },
        { amount: 2000, date: new Date(2026, 5, 10, 12) },
      ],
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    // NaN-Date wird uebersprungen, die zweite Execution zaehlt
    expect(result[0].actual).toBe(2000)
  })

  it('months=0 liefert ein leeres Array', () => {
    const goal = { monthlyRate: 5000, executions: [] }
    expect(buildSavingsMonthlyProgress(goal, 0, NOW)).toEqual([])
  })

  it('months=1 liefert nur den aktuellen Monat', () => {
    const goal = { monthlyRate: 5000, executions: [] }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    expect(result).toHaveLength(1)
    expect(result[0].month).toBe('2026-06')
  })
})

describe('buildSavingsMonthlyProgress — percentUsed Praezision', () => {
  it('rundet auf 1 Nachkommastelle', () => {
    const goal = {
      monthlyRate: 3000, // 30 €
      executions: [{ amount: 1234, date: new Date(2026, 5, 10, 12) }], // 12.34 €
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    // 1234 / 3000 * 100 = 41.1333... -> 41.1
    expect(result[0].percentUsed).toBe(41.1)
  })

  it('zeigt 0.0 bei minimaler Auslastung', () => {
    const goal = {
      monthlyRate: 10000, // 100 €
      executions: [{ amount: 5, date: new Date(2026, 5, 10, 12) }], // 0.05 €
    }
    const result = buildSavingsMonthlyProgress(goal, 1, NOW)
    // 5 / 10000 * 100 = 0.05 -> 0.1
    expect(result[0].percentUsed).toBe(0.1)
  })
})
