import { describe, expect, it } from 'vitest'
import type { RecurringFrequency } from '@prisma/client'
import {
  computeCoveragePercent,
  getRecurringPeriodsInMonth,
  isDateInBucket,
} from '../recurring-periods'

/**
 * Tests fuer `recurring-periods.ts` (issue #59, ADR 0002).
 *
 * Coverage:
 *  - getRecurringPeriodsInMonth: alle 5 Frequenzen, Monats-Anker
 *    (Quarterly/Yearly), Mo-So-Wochen (Weekly), ONCE-Fenster
 *  - isDateInBucket: Halb-offenes Intervall (start, end)
 *  - computeCoveragePercent: Capping, due=0
 *  - Edge Cases: endDate in Vergangenheit, startDate in Zukunft,
 *    Jahreswechsel, Monatsgrenzen
 */

const NOW = new Date(2026, 5, 17, 12) // 17. Juni 2026, Mittag

function plan(
  frequency: RecurringFrequency,
  startDate: Date | string,
  endDate: Date | string | null = null,
) {
  return { frequency, startDate, endDate }
}

describe('getRecurringPeriodsInMonth — MONTHLY', () => {
  it('liefert genau einen Bucket pro Monat', () => {
    const result = getRecurringPeriodsInMonth(
      plan('MONTHLY', '2026-01-15T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0].key).toBe('2026-06')
    expect(result.buckets[0].start.getMonth()).toBe(5)
  })

  it('nextDueDate ist der erste Tag des aktuellen Monats (Bucket-Start)', () => {
    const result = getRecurringPeriodsInMonth(
      plan('MONTHLY', '2026-01-15T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.nextDueDate).not.toBeNull()
    expect(result.nextDueDate!.getMonth()).toBe(5)
    expect(result.nextDueDate!.getDate()).toBe(1)
  })

  it('Plan startet in der Zukunft -> leere Buckets', () => {
    const result = getRecurringPeriodsInMonth(
      plan('MONTHLY', '2027-01-15T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toEqual([])
  })

  it('endDate in der Vergangenheit -> leere Buckets, nextDueDate null', () => {
    const result = getRecurringPeriodsInMonth(
      plan('MONTHLY', '2025-01-15T12:00:00', '2025-12-15T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toEqual([])
    expect(result.nextDueDate).toBeNull()
  })
})

describe('getRecurringPeriodsInMonth — WEEKLY (Mo-So)', () => {
  it('liefert 4-5 Buckets pro Monat (Juni 2026)', () => {
    const result = getRecurringPeriodsInMonth(
      plan('WEEKLY', '2025-12-29T12:00:00'), // vor Juni 2026
      2026,
      5,
      NOW,
    )
    // Juni 2026 startet am Montag. Wochen mit Montag im Juni:
    // 1.6, 8.6, 15.6, 22.6, 29.6 = 5 Wochen
    expect(result.buckets).toHaveLength(5)
    expect(result.buckets[0].key).toBe('2026-W23') // 1.6. ist Mo, ISO W23
    expect(result.buckets[0].start.getDate()).toBe(1)
    expect(result.buckets[0].end.getDate()).toBe(8) // naechster Montag
  })

  it('Montag entscheidet Monatszugehoerigkeit: Woche ab 29.6. ist Juni, nicht Juli', () => {
    const result = getRecurringPeriodsInMonth(
      plan('WEEKLY', '2025-12-29T12:00:00'),
      2026,
      5, // Juni
      NOW,
    )
    const lastBucket = result.buckets[result.buckets.length - 1]
    expect(lastBucket.start.getDate()).toBe(29) // Mo 29.6.
    expect(lastBucket.end.getDate()).toBe(6) // So 5.7. = 6.7., Mo 6.7. = naechster
  })

  it('startDate mitten im Monat: nur Wochen ab startDate', () => {
    const result = getRecurringPeriodsInMonth(
      plan('WEEKLY', '2026-06-15T12:00:00'), // Mo 15.6. = ab hier
      2026,
      5,
      NOW,
    )
    // Wochen ab 15.6. (Mo): 15.6, 22.6, 29.6 = 3 Wochen
    expect(result.buckets).toHaveLength(3)
    expect(result.buckets[0].start.getDate()).toBe(15)
  })
})

describe('getRecurringPeriodsInMonth — QUARTERLY', () => {
  it('startDate Februar -> Feb/Mai/Aug/Nov sind Due-Monate', () => {
    // startDate 2026-02-10: Anker-Month = 1 (Feb)
    // Monate mit (month % 3 == 1): Feb, May, Aug, Nov
    const mayResult = getRecurringPeriodsInMonth(
      plan('QUARTERLY', '2026-02-10T12:00:00'),
      2026,
      4, // Mai
      NOW,
    )
    expect(mayResult.buckets).toHaveLength(1)
    expect(mayResult.buckets[0].key).toBe('2026-05')

    const juneResult = getRecurringPeriodsInMonth(
      plan('QUARTERLY', '2026-02-10T12:00:00'),
      2026,
      5, // Juni (KEIN Due-Monat)
      NOW,
    )
    expect(juneResult.buckets).toEqual([])
  })

  it('startDate Maerz -> Maerz/Juni/Sep/Dez sind Due-Monate', () => {
    // startDate 2026-03-15: Anker-Month = 2 (Maerz)
    // Monate mit (month % 3 == 2): Maerz, Juni, Sep, Dez
    const june = getRecurringPeriodsInMonth(
      plan('QUARTERLY', '2026-03-15T12:00:00'),
      2026,
      5, // Juni
      NOW,
    )
    expect(june.buckets).toHaveLength(1)
    expect(june.buckets[0].key).toBe('2026-06')
  })
})

describe('getRecurringPeriodsInMonth — YEARLY', () => {
  it('startDate Maerz -> nur Maerz ist Due-Monat', () => {
    const march = getRecurringPeriodsInMonth(
      plan('YEARLY', '2025-03-15T12:00:00'),
      2026,
      2, // Maerz
      NOW,
    )
    expect(march.buckets).toHaveLength(1)
    expect(march.buckets[0].key).toBe('2026-03')

    const april = getRecurringPeriodsInMonth(
      plan('YEARLY', '2025-03-15T12:00:00'),
      2026,
      3, // April
      NOW,
    )
    expect(april.buckets).toEqual([])
  })
})

describe('getRecurringPeriodsInMonth — ONCE', () => {
  it('startDate im aktuellen Monat -> 1 Bucket', () => {
    const result = getRecurringPeriodsInMonth(
      plan('ONCE', '2026-06-10T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0].key).toBe('2026-06')
  })

  it('startDate vor aktuellem Monat, kein endDate -> 1 Bucket', () => {
    // ONCE ohne endDate: einmalig, gilt "ab startDate"
    const result = getRecurringPeriodsInMonth(
      plan('ONCE', '2026-04-10T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toHaveLength(1)
  })

  it('startDate vor aktuellem Monat, endDate in Vergangenheit -> leer', () => {
    const result = getRecurringPeriodsInMonth(
      plan('ONCE', '2025-01-10T12:00:00', '2025-02-10T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toEqual([])
  })

  it('endDate innerhalb des aktuellen Monats -> 1 Bucket (Bucket = Monat von startDate)', () => {
    // Plan laeuft im Juni, endet am 15.6. (mitten im Monat)
    const result = getRecurringPeriodsInMonth(
      plan('ONCE', '2026-06-01T12:00:00', '2026-06-15T12:00:00'),
      2026,
      5,
      NOW,
    )
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0].key).toBe('2026-06')
  })
})

describe('isDateInBucket (Halb-offenes Intervall)', () => {
  it('Datum == start -> inkludiert', () => {
    const bucket = {
      key: '2026-06',
      start: new Date(2026, 5, 1, 0, 0, 0),
      end: new Date(2026, 6, 1, 0, 0, 0),
    }
    expect(isDateInBucket(new Date(2026, 5, 1, 0, 0, 0), bucket)).toBe(true)
  })

  it('Datum == end -> NICHT inkludiert (Bucket-ende ist exklusiv)', () => {
    const bucket = {
      key: '2026-06',
      start: new Date(2026, 5, 1),
      end: new Date(2026, 6, 1),
    }
    // 1. Juli = 2026-07-01 = exakt end -> exklusiv, also nicht im Bucket
    expect(isDateInBucket(new Date(2026, 6, 1), bucket)).toBe(false)
  })

  it('Datum mitten im Bucket -> inkludiert', () => {
    const bucket = {
      key: '2026-06',
      start: new Date(2026, 5, 1),
      end: new Date(2026, 6, 1),
    }
    expect(isDateInBucket(new Date(2026, 5, 15), bucket)).toBe(true)
  })

  it('akzeptiert ISO-String-Dates (von JSON / Prisma serialisiert)', () => {
    const bucket = {
      key: '2026-06',
      start: new Date(2026, 5, 1),
      end: new Date(2026, 6, 1),
    }
    expect(isDateInBucket('2026-06-15T12:00:00.000Z', bucket)).toBe(true)
  })
})

describe('computeCoveragePercent', () => {
  it('due=0 -> 0 (Caller interpretiert als "kein Status")', () => {
    expect(computeCoveragePercent(0, 0)).toBe(0)
    expect(computeCoveragePercent(2, 0)).toBe(0) // paid ohne due: 0
  })

  it('volle Coverage', () => {
    expect(computeCoveragePercent(3, 3)).toBe(100)
  })

  it('partielle Coverage mit Nachkommastelle', () => {
    // 1 von 3 = 33.3%
    expect(computeCoveragePercent(1, 3)).toBe(33.3)
  })

  it('mehr als 100% -> capping auf 100', () => {
    expect(computeCoveragePercent(5, 3)).toBe(100)
  })

  it('0% ohne Bezahlung', () => {
    expect(computeCoveragePercent(0, 4)).toBe(0)
  })
})
