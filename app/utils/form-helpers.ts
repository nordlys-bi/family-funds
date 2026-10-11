/*
 * Geteilte Helper-Texte und Konstanten fuer Form-Felder.
 *
 * Aktuell nur ein Datum-Helper-Text, aber DRY lohnt sich: kommt an drei
 * Stellen vor (Expense-Form, Income-Form, Sparziel-Booking-Dialog) und
 * bei einer Copy-Aenderung wuerde man sonst drei Stellen pflegen muessen.
 *
 * Pattern-Notiz (issue #54): die Helper-Texte sind bewusst kurz und
 * erklaerend — der User soll wissen, dass das Datum im Default-Flow auf
 * "heute" steht, ohne erst das leere Feld raten zu muessen.
 */

/**
 * Helper-Text fuer Datums-Felder, deren Default-Wert das aktuelle Datum
 * ist. Wird unter dem DatePicker als dezenter Hinweis gerendert.
 *
 * Verwendung:
 *   <DatePicker v-model="form.date" ... />
 *   <small class="form-field-helper">{{ todayDateHelperText }}</small>
 *
 * Die zugehoerige CSS-Klasse `.form-field-helper` ist global in
 * `app/assets/css/base.css` definiert.
 */
export const todayDateHelperText = 'Voreinstellung: heute. Nur bei Bedarf ändern.'

/**
 * Wert eines DatePickers als 'YYYY-MM-DD' im LOKALEN Kalendertag — das
 * Format, das `parseDateInput` auf dem Server erwartet. Der DatePicker
 * liefert nach einer Auswahl ein `Date` (lokale Mitternacht); unveraendert
 * per JSON verschickt wuerde daraus ein UTC-ISO-String, der in Zonen oestlich
 * von UTC sogar auf den Vortag faellt und serverseitig als ungueltig abgelehnt
 * wird. Strings (ISO mit Zeit oder bereits 'YYYY-MM-DD') werden auf den
 * Datumsteil gekuerzt.
 */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value.split('T')[0] ?? ''
  if (Number.isNaN(value.getTime())) return ''
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

/**
 * 'YYYY-MM-DD' (oder ISO-String) als lokales `Date` fuer einen DatePicker —
 * 12:00 statt Mitternacht, damit keine Zeitzonen-Verschiebung den Tag kippt.
 */
export function fromDateInputValue(value: string | null | undefined): Date | null {
  const day = toDateInputValue(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return new Date(`${day}T12:00:00`)
}
