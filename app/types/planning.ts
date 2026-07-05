/**
 * Planning-Domain-Typen.
 *
 * Wird im Frontend (Budgets / Recurring / Savings Pages) und in
 * Server-Utilities (planning.ts) verwendet. Hier nur die TypeScript-Types,
 * weil die Runtime-Funktionen in `~/utils/planning-format` liegen.
 */

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

/** ISO-Datum als String (YYYY-MM-DD) oder null/leer. */
export type DateInputString = string | null | undefined

/** Date | null, wie es PrimeVue DatePicker liefert. */
export type DateFormValue = Date | null

/** Reusable Severity-Form für unsere globalen Notice-Tags. */
export type NoticeSeverity = 'success' | 'warn' | 'error'

export type Notice = { severity: NoticeSeverity; text: string }
