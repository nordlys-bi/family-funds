import { describe, expect, it } from 'vitest'
import { formatBudgetPeriodLabel } from '../planning-format'

/**
 * Tests fuer `formatBudgetPeriodLabel` — kuerzestmoegliches Datumsformat
 * fuer die Perioden-Zeile einer Dashboard-Budget-Karte (issue-request:
 * "1.-30.9.26" statt "Sept. 2026" / "14.-20.9.26" statt "KW 38").
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

describe('formatBudgetPeriodLabel', () => {
  it('MONTHLY: gleicher Monat -> "1.-30.9.26" (periodEnd exklusiv, 1 Tag abgezogen)', () => {
    // periodEnd = 1. Oktober (exklusiv) -> angezeigt wird der 30. September.
    expect(formatBudgetPeriodLabel(iso(2026, 9, 1), iso(2026, 10, 1))).toBe('1.-30.9.26')
  })

  it('WEEKLY: gleicher Monat -> "14.-20.9.26"', () => {
    expect(formatBudgetPeriodLabel(iso(2026, 9, 14), iso(2026, 9, 21))).toBe('14.-20.9.26')
  })

  it('QUARTERLY: unterschiedliche Monate, gleiches Jahr -> "1.4.-30.6.26"', () => {
    expect(formatBudgetPeriodLabel(iso(2026, 4, 1), iso(2026, 7, 1))).toBe('1.4.-30.6.26')
  })

  it('YEARLY: unterschiedliche Monate, gleiches Jahr -> "1.1.-31.12.26"', () => {
    expect(formatBudgetPeriodLabel(iso(2026, 1, 1), iso(2027, 1, 1))).toBe('1.1.-31.12.26')
  })

  it('WEEKLY ueber einen Jahreswechsel -> "29.12.25-4.1.26"', () => {
    expect(formatBudgetPeriodLabel(iso(2025, 12, 29), iso(2026, 1, 5))).toBe('29.12.25-4.1.26')
  })

  it('ONCE offen (periodEnd null) -> "seit D.M.YY", kein Bindestrich-Range', () => {
    expect(formatBudgetPeriodLabel(iso(2026, 7, 27), null)).toBe('seit 27.7.26')
  })

  it('ONCE mit Nachfolge-Version (periodEnd gesetzt) -> normale Range', () => {
    expect(formatBudgetPeriodLabel(iso(2026, 3, 5), iso(2026, 8, 1))).toBe('5.3.-31.7.26')
  })

  it('Ein-Tages-Periode (Start und inklusives Ende identisch)', () => {
    // periodEnd = naechster Tag (exklusiv) -> ein einzelner Tag Spanne.
    expect(formatBudgetPeriodLabel(iso(2026, 9, 14), iso(2026, 9, 15))).toBe('14.-14.9.26')
  })
})
