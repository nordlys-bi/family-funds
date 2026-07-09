/*
 * Month-Filter-Helpers fuer YYYY-MM-basierte Zeitfilter.
 *
 * Wird sowohl in Composables (useTransactionList) als auch in
 * Pages (URL-Sync, Select-Optionen) verwendet. Auto-importiert
 * via Nuxt-Utils-Konvention (jeder Export aus `app/utils/` ist
 * ohne expliziten Import verfügbar).
 *
 * Format-Konvention: `YYYY-MM` mit zweistelligem Monat 01-12.
 * Beispiel: "2026-07" fuer Juli 2026.
 */

const MONTH_REGEX = /^\d{4}-\d{2}$/

/** Aktueller Monat im YYYY-MM-Format, lokal. */
export function currentMonthYYYYMM(baseDate = new Date()): string {
  const year = baseDate.getFullYear()
  const month = String(baseDate.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/** True, wenn String exakt dem YYYY-MM-Format entspricht (Regex-Check, keine Range-Pruefung). */
export function isMonthYYYYMMFormat(value: unknown): value is string {
  return typeof value === 'string' && MONTH_REGEX.test(value)
}

/** True, wenn Monats-Teil 01-12 und Jahr 1900-3000 (semantische Gültigkeit). */
export function isValidMonthYYYYMM(value: unknown): value is string {
  if (!isMonthYYYYMMFormat(value)) return false
  const [yearStr, monthStr] = value.split('-')
  const year = Number(yearStr)
  const monthIdx = Number(monthStr) - 1
  if (monthIdx < 0 || monthIdx > 11) return false
  if (!Number.isInteger(year) || year < 1900 || year > 3000) return false
  return true
}

/** Liefert die Date-Range (Start inklusiv, Ende exklusiv) fuer ein YYYY-MM. */
export function parseMonthRange(yyyymm: string): { start: Date; end: Date } | null {
  if (!isValidMonthYYYYMM(yyyymm)) return null
  const [yearStr, monthStr] = yyyymm.split('-')
  const year = Number(yearStr)
  const monthIdx = Number(monthStr) - 1
  return {
    start: new Date(year, monthIdx, 1, 0, 0, 0, 0),
    end: new Date(year, monthIdx + 1, 1, 0, 0, 0, 0),
  }
}

/**
 * Menschenlesbares Label fuer ein YYYY-MM im de-DE-Format.
 * Beispiel: "2026-07" → "Juli 2026".
 */
export function formatMonthLabel(yyyymm: string, locale = 'de-DE'): string {
  const range = parseMonthRange(yyyymm)
  if (!range) return yyyymm
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(range.start)
}

/**
 * Select-Optionen fuer die letzten N Monate (inkl. aktueller Monat),
 * neueste zuerst. Beispiel fuer n=3 im Juli 2026:
 *   [{value: "2026-07", label: "Juli 2026"},
 *    {value: "2026-06", label: "Juni 2026"},
 *    {value: "2026-05", label: "Mai 2026"}]
 */
export function lastNMonths(n: number, baseDate = new Date(), locale = 'de-DE'): Array<{ value: string; label: string }> {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
  const options: Array<{ value: string; label: string }> = []
  for (let offset = 0; offset < n; offset++) {
    const date = new Date(baseDate.getFullYear(), baseDate.getMonth() - offset, 1)
    const value = currentMonthYYYYMM(date)
    options.push({ value, label: formatter.format(date) })
  }
  return options
}
