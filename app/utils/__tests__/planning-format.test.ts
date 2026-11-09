import { describe, expect, it } from 'vitest'
import { formatEnvelopePeriodLabel } from '../planning-format'

/**
 * Tests fuer `formatEnvelopePeriodLabel` — frequenzabhaengiges Label fuer die
 * Perioden-Zeile einer Dashboard-Budget-Karte, z. B. "KW 38 (14.-20. Sept.)"
 * (WEEKLY) / "Sept. 2026" (MONTHLY) / "Q3 2026" (QUARTERLY) / "2026"
 * (YEARLY) / "seit 27.7.26" (ONCE, offen) / "5.3.-31.7.26" (ONCE mit
 * Nachfolge-Version).
 *
 * `iso(y, m, d)` baut einen ISO-String ueber eine LOKALE Date-Konstruktion
 * (noon, wie die echte App: `startOfPeriod`/`addPeriod` normalisieren auf
 * 12:00 lokale Serverzeit) — Konstruktion und Parsing laufen im selben
 * Prozess/Timezone, der Roundtrip ist deshalb unabhaengig von der
 * tatsaechlichen Test-Runner-Timezone stabil.
 */
function iso(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12).toISOString()
}

describe('formatEnvelopePeriodLabel', () => {
  it('MONTHLY -> "Sept. 2026"', () => {
    // periodEnd = 1. Oktober (exklusiv) -> Periode ist September.
    expect(formatEnvelopePeriodLabel('MONTHLY', iso(2026, 9, 1), iso(2026, 10, 1))).toBe('Sept. 2026')
  })

  it('MONTHLY: Juni/Juli werden ausgeschrieben (CLDR vermeidet "Jun."/"Jul."-Verwechslung)', () => {
    expect(formatEnvelopePeriodLabel('MONTHLY', iso(2026, 6, 1), iso(2026, 7, 1))).toBe('Juni 2026')
    expect(formatEnvelopePeriodLabel('MONTHLY', iso(2026, 7, 1), iso(2026, 8, 1))).toBe('Juli 2026')
  })

  it('WEEKLY: gleicher Monat -> "KW 38 (14.-20. Sept.)"', () => {
    expect(formatEnvelopePeriodLabel('WEEKLY', iso(2026, 9, 14), iso(2026, 9, 21))).toBe('KW 38 (14.-20. Sept.)')
  })

  it('WEEKLY: Monatswechsel -> "KW 44 (26. Okt.-1. Nov.)"', () => {
    expect(formatEnvelopePeriodLabel('WEEKLY', iso(2026, 10, 26), iso(2026, 11, 2))).toBe('KW 44 (26. Okt.-1. Nov.)')
  })

  it('WEEKLY ueber einen Jahreswechsel -> "KW 53 (28. Dez. 26-3. Jan. 27)"', () => {
    expect(formatEnvelopePeriodLabel('WEEKLY', iso(2026, 12, 28), iso(2027, 1, 4))).toBe('KW 53 (28. Dez. 26-3. Jan. 27)')
  })

  it('QUARTERLY -> "Q2 2026"', () => {
    expect(formatEnvelopePeriodLabel('QUARTERLY', iso(2026, 4, 1), iso(2026, 7, 1))).toBe('Q2 2026')
  })

  it('YEARLY -> "2026"', () => {
    expect(formatEnvelopePeriodLabel('YEARLY', iso(2026, 1, 1), iso(2027, 1, 1))).toBe('2026')
  })

  it('ONCE offen (periodEnd null) -> "seit D.M.YY", kein Bindestrich-Range', () => {
    expect(formatEnvelopePeriodLabel('ONCE', iso(2026, 7, 27), null)).toBe('seit 27.7.26')
  })

  it('ONCE mit Nachfolge-Version (periodEnd gesetzt) -> kompakte Zahlen-Range', () => {
    expect(formatEnvelopePeriodLabel('ONCE', iso(2026, 3, 5), iso(2026, 8, 1))).toBe('5.3.-31.7.26')
  })
})
