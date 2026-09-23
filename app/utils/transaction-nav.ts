/**
 * Navigation zwischen Ausgaben und Einnahmen (issue #101).
 *
 * "Buchungen" besteht aus zwei Routen (`/transactions/expenses`,
 * `/transactions/income`), die ein gemeinsames Segment-Control verbindet.
 * Die Routen bleiben bewusst getrennt, weil Deep-Links auf sie zeigen
 * (`?unassigned=1`, `?from&to`, `?new=1`, Onboarding-Ziel).
 *
 * Beim Wechsel bleibt nur, was auf BEIDEN Seiten Sinn ergibt:
 *  - `month` (nur wenn ein gueltiges YYYY-MM — beide Seiten lassen den
 *    Default "aktueller Monat" aus der URL weg),
 *  - `userId` (Person-Filter, beide Seiten nutzen dieselben Mitglieds-IDs).
 * Ausgaben-spezifisches (`unassigned`, `from`/`to`, `budgetId`) und
 * Einmal-Trigger (`new`) werden verworfen: Einnahmen haben kein Budget, und
 * ein Zeitraum-Chip von einer Budget-Karte gehoert nicht in die Einnahmen.
 */

import { isValidMonthYYYYMM } from './month-filter'

export type TransactionType = 'expenses' | 'income'

export const TRANSACTION_TYPE_PATHS: Record<TransactionType, string> = {
  expenses: '/transactions/expenses',
  income: '/transactions/income',
}

type QueryLike = Record<string, unknown>

/** Welche Buchungsart zeigt dieser Pfad? `null` ausserhalb von Ausgaben/Einnahmen. */
export function transactionTypeFromPath(path: string): TransactionType | null {
  for (const type of Object.keys(TRANSACTION_TYPE_PATHS) as TransactionType[]) {
    const base = TRANSACTION_TYPE_PATHS[type]
    if (path === base || path.startsWith(`${base}/`)) return type
  }
  return null
}

/** Liegt der Pfad im Buchungen-Bereich (Ausgaben, Einnahmen oder der Einstieg `/transactions`)? */
export function isTransactionsPath(path: string): boolean {
  return path === '/transactions' || path.startsWith('/transactions/')
}

function firstString(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' ? candidate : null
}

/** Der Teil des aktuellen Query, der beim Wechsel zwischen Ausgaben und Einnahmen mitgenommen wird. */
export function transactionSwitchQuery(query: QueryLike): Record<string, string> {
  const carried: Record<string, string> = {}

  const month = firstString(query.month)
  if (month && isValidMonthYYYYMM(month)) carried.month = month

  const userId = firstString(query.userId)
  if (userId && userId.length > 0) carried.userId = userId

  return carried
}

/** Router-Ziel fuer den Wechsel auf `type`, ausgehend vom aktuellen Query. */
export function transactionSwitchTarget(
  type: TransactionType,
  query: QueryLike,
): { path: string; query: Record<string, string> } {
  return { path: TRANSACTION_TYPE_PATHS[type], query: transactionSwitchQuery(query) }
}
