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
 * Kuerzestmoegliches Datumsformat fuer eine Perioden-Spanne, z. B.
 * "1.-30.9.26". Nur noch fuer ONCE-Perioden mit Nachfolge-Version genutzt
 * (alle anderen Frequenzen haben ein eigenes, lesbareres Label — siehe
 * `formatBudgetPeriodLabel`). `start` und `endInclusive` sind beide
 * inklusiv — der Aufrufer zieht bei einem exklusiven Ende (periodEnd)
 * vorher einen Tag ab.
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
 * ISO-8601-Kalenderwoche einer Date. Donnerstag der Woche bestimmt die KW
 * (ISO-Regel).
 */
function isoWeekNumber(date: Date): number {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const dayNum = (target.getDay() + 6) % 7 // Mo = 0, So = 6
  target.setDate(target.getDate() - dayNum + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

// "Tag. Monat" im Format-Kontext (mit Tag kombiniert) — die de-DE-CLDR-Daten
// schreiben Juni/Juli hier bewusst aus ("15. Juni"), weil "Jun."/"Jul."
// abgekuerzt zu leicht verwechselt werden; alle anderen Monate werden knapp
// abgekuerzt ("15. Sept."). Gleiche Formatter-Konfiguration wie
// MONTH_YEAR_FORMATTER, daher identisches Verhalten fuer alle 12 Monate.
const DAY_MONTH_FORMATTER = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' })

/**
 * Datumsrange fuer die KW-Klammer einer WEEKLY-Karte. `start` und
 * `endInclusive` sind beide inklusiv.
 *  - gleicher Monat:      "14.-20. Sept."
 *  - Monatswechsel:       "26. Okt.-1. Nov."
 *  - Jahreswechsel:       "28. Dez. 25-3. Jan. 26"
 */
function formatWeekRange(start: Date, endInclusive: Date): string {
  const sameYear = start.getFullYear() === endInclusive.getFullYear()
  const sameMonth = sameYear && start.getMonth() === endInclusive.getMonth()

  if (sameMonth) {
    return `${start.getDate()}.-${DAY_MONTH_FORMATTER.format(endInclusive)}`
  }
  if (sameYear) {
    return `${DAY_MONTH_FORMATTER.format(start)}-${DAY_MONTH_FORMATTER.format(endInclusive)}`
  }
  return `${DAY_MONTH_FORMATTER.format(start)} ${shortYear(start.getFullYear())}-${DAY_MONTH_FORMATTER.format(endInclusive)} ${shortYear(endInclusive.getFullYear())}`
}

/**
 * Lesbares Label fuer die aktuell laufende Periode einer Dashboard-Budget-
 * Karte, frequenzabhaengig: Nutzer denken bei einem Monatsbudget an
 * "Sept. 2026", nicht an den Tag-Range "1.-30.9.26" — die exakte Spanne
 * bleibt trotzdem ueberpruefbar, weil ein Klick auf die Karte exakt danach
 * filtert (siehe `transactionsLink` in `DashboardBudgetPeriodGrid.vue`).
 *
 * Beispiele: "KW 38 (14.-20. Sept.)" (WEEKLY) / "Sept. 2026" (MONTHLY) /
 * "Q3 2026" (QUARTERLY) / "2026" (YEARLY) / "seit 27.7.26" (ONCE, offen) /
 * "5.3.-31.7.26" (ONCE mit Nachfolge-Version).
 */
export function formatBudgetPeriodLabel(
  frequency: Frequency,
  periodStart: string,
  periodEnd: string | null,
): string {
  const start = new Date(periodStart)
  if (!periodEnd) {
    return `seit ${start.getDate()}.${start.getMonth() + 1}.${shortYear(start.getFullYear())}`
  }
  // periodEnd ist exklusiv (wie monthEnd) — fuer die Anzeige einen Tag
  // abziehen, sonst wuerde z. B. eine Woche als "14.-21." statt "14.-20."
  // angezeigt (der 21. gehoert schon zur naechsten Periode).
  const endInclusive = new Date(periodEnd)
  endInclusive.setDate(endInclusive.getDate() - 1)

  switch (frequency) {
    case 'WEEKLY':
      return `KW ${isoWeekNumber(start)} (${formatWeekRange(start, endInclusive)})`
    case 'MONTHLY':
      return MONTH_YEAR_FORMATTER.format(start)
    case 'QUARTERLY':
      return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
    case 'YEARLY':
      return `${start.getFullYear()}`
    case 'ONCE':
      return formatShortDateRange(start, endInclusive)
  }
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
