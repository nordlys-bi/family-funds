/*
 * Planning-Format-Helpers und Frequency-Logik.
 *
 * Auto-importiert in allen Vue-Komponenten unter `app/` via Nuxt-Utils-Konvention
 * (jeder Export aus `app/utils/` ist ohne expliziten Import verfügbar).
 *
 * Enthalten:
 * - Money-Formatter (Currency-aware, de-DE).
 * - Date-Helpers (ISO-Input-Format, DE-Locale-Anzeige, Date|String-Round-Trip).
 * - Frequency-Label/Options für `<Select>`.
 * - Monthly-Equivalent-Conversion für Recurring-Pläne.
 * - Period-Start-Berechnung (für Budgets: erstes gültiges Datum je Frequenz).
 */

import type { DateInputString, Frequency } from '~/types/planning'

// === Money / Currency ======================================================

/**
 * Erstellt einen Memoized Intl.NumberFormat im de-DE-Stil für die gegebene
 * Currency. Cache ist bewusst nicht instanziiert — die Pages haben aktuell
 * nur einen Currency-Wechsel pro Haushalt-Wechsel.
 */
export function createMoneyFormatter(currency: string): Intl.NumberFormat {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency })
}

/**
 * Formatiert einen in **Cent** gespeicherten Betrag in einen lokalisierten
 * Currency-String (z. B. 12500 → "125,00 €").
 */
export function formatMoneyFromCents(value: number, currency: string): string {
  return createMoneyFormatter(currency).format(value / 100)
}

// === Date Helpers ===========================================================

const DATE_INPUT_FORMATTER = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** Konvertiert ISO-String | null → "27. Jul. 2026" oder "—" für null. */
export function formatPlanningDate(value: string | null): string {
  if (!value) return '—'
  return DATE_INPUT_FORMATTER.format(new Date(value))
}

/** Date → "YYYY-MM-DD" (lokal, kein UTC-Shift). Für HTML-Date-Inputs / API. */
export function formatDateToInputString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

/** "YYYY-MM-DD" | null/undefined → Date | null. Setzt 12:00 lokal für TZ-Stabilität. */
export function parseDateInputString(value: DateInputString): Date | null {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

// === Frequency ==============================================================

/** Anzeige-Label für eine Frequency. Single-Source-of-Truth in DE-Locale. */
export function frequencyLabel(frequency: Frequency): string {
  switch (frequency) {
    case 'WEEKLY': return 'Wöchentlich'
    case 'MONTHLY': return 'Monatlich'
    case 'QUARTERLY': return 'Quartalsweise'
    case 'YEARLY': return 'Jährlich'
    case 'ONCE': return 'Einmalig'
  }
}

/** Select-Optionen für Frequency, Memo-fertig gebaut. */
export function frequencySelectOptions(): Array<{ label: string; value: Frequency }> {
  return [
    { label: 'Wöchentlich', value: 'WEEKLY' },
    { label: 'Monatlich', value: 'MONTHLY' },
    { label: 'Quartalsweise', value: 'QUARTERLY' },
    { label: 'Jährlich', value: 'YEARLY' },
    { label: 'Einmalig', value: 'ONCE' },
  ]
}

/**
 * Umrechnungsfaktor von der angegebenen Frequenz auf ein Monats-Equivalent.
 * Für Recurring-Pläne: Wie viel Prozent eines Monats entspricht eine
 * Periode dieser Frequenz?
 */
export function monthlyFrequencyFactor(frequency: Frequency): number {
  switch (frequency) {
    case 'WEEKLY': return 52 / 12
    case 'MONTHLY': return 1
    case 'QUARTERLY': return 1 / 3
    case 'YEARLY': return 1 / 12
    case 'ONCE': return 1
  }
}

// === Dashboard-Budget-Perioden-Label ========================================

/** Jahreszahl auf 2-stellig gekuerzt, z. B. 2026 -> "26". */
function shortYear(year: number): string {
  return String(year % 100).padStart(2, '0')
}

/**
 * Kuerzestmoegliches Datumsformat fuer eine Perioden-Spanne (issue-request:
 * "1.-30.9.26" statt "Sept. 2026" / "14.-20.9.26" statt "KW 38"). `start`
 * und `endInclusive` sind beide inklusiv — der Aufrufer zieht bei einem
 * exklusiven Ende (periodEnd) vorher einen Tag ab.
 *
 * Format haengt davon ab, wie viel Start und Ende teilen:
 *  - gleicher Monat+Jahr:  "1.-30.9.26"
 *  - gleiches Jahr:        "28.9.-4.10.26"
 *  - unterschiedl. Jahre:  "29.12.25-4.1.26"
 */
function formatShortDateRange(start: Date, endInclusive: Date): string {
  const sameYear = start.getFullYear() === endInclusive.getFullYear()
  const sameMonth = sameYear && start.getMonth() === endInclusive.getMonth()
  const endYY = shortYear(endInclusive.getFullYear())

  if (sameMonth) {
    return `${start.getDate()}.-${endInclusive.getDate()}.${endInclusive.getMonth() + 1}.${endYY}`
  }
  if (sameYear) {
    return `${start.getDate()}.${start.getMonth() + 1}.-${endInclusive.getDate()}.${endInclusive.getMonth() + 1}.${endYY}`
  }
  const startYY = shortYear(start.getFullYear())
  return `${start.getDate()}.${start.getMonth() + 1}.${startYY}-${endInclusive.getDate()}.${endInclusive.getMonth() + 1}.${endYY}`
}

/**
 * Kompaktes Datums-Label fuer die aktuell laufende Periode einer Dashboard-
 * Budget-Karte, z. B. "1.-30.9.26" (MONTHLY) / "14.-20.9.26" (WEEKLY) /
 * "1.7.-30.9.26" (QUARTERLY) / "1.1.-31.12.26" (YEARLY) / "seit 27.7.26"
 * (ONCE, offen — kein Enddatum anzeigbar).
 */
export function formatBudgetPeriodLabel(
  periodStart: string,
  periodEnd: string | null,
): string {
  const start = new Date(periodStart)
  if (!periodEnd) {
    return `seit ${start.getDate()}.${start.getMonth() + 1}.${shortYear(start.getFullYear())}`
  }
  // periodEnd ist exklusiv (wie monthEnd) — fuer die Anzeige einen Tag
  // abziehen, sonst wuerde z. B. eine Woche als "14.-21.9.26" statt
  // "14.-20.9.26" angezeigt (der 21. gehoert schon zur naechsten Periode).
  const endInclusive = new Date(periodEnd)
  endInclusive.setDate(endInclusive.getDate() - 1)
  return formatShortDateRange(start, endInclusive)
}

/**
 * Liefert das erste gültige Datum einer Periode der angegebenen Frequenz,
 * berechnet ab `value`. Heute ist der Default.
 *
 * Beispiele (für today = 2026-07-05):
 * - WEEKLY   → 2026-06-30 (Montag der ISO-Woche)
 * - MONTHLY  → 2026-07-01
 * - YEARLY   → 2026-01-01
 */
export function getPeriodStartDate(value: Date, frequency: Frequency): Date {
  const date = new Date(value)
  date.setHours(12, 0, 0, 0)
  switch (frequency) {
    case 'WEEKLY': {
      const day = date.getDay()
      const offset = day === 0 ? -6 : 1 - day
      date.setDate(date.getDate() + offset)
      break
    }
    case 'MONTHLY':
      date.setDate(1)
      break
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3
      date.setMonth(quarterStartMonth, 1)
      break
    }
    case 'YEARLY':
      date.setMonth(0, 1)
      break
    case 'ONCE':
      break
  }
  return date
}
