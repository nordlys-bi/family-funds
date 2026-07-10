/*
 * Einheitlicher API-Response-Envelope fuer Family-Funds (issue #27).
 *
 * Vorher: Manche Endpoints lieferten `{ kind, item }`, manche
 * `{ household }`, manche `{ success: true }`, manche rohe Daten
 * (`dashboard.get.ts`). Fehler waren mal H3-konform (`createError`),
 * manchmal custom JSON.
 *
 * Nachher: Alle CRUD-Mutations (POST/PATCH/DELETE) wickeln ihre Daten
 * in `{ data: T }` ein. Fehler laufen weiterhin ueber `createError` —
 * h3 formt sie bereits konsistent zu `{ statusCode, statusMessage, ... }`,
 * und Nuxt-Clients ($fetch) liefern diese als Error-Objekt.
 *
 * GET-Endpoints duerfen Stufe 2 sein (Issue-Acceptance). Wenn sie
 * migriert werden, koennen sie ebenfalls `defineApiResponse` nutzen,
 * aber das Frontend kann erstmal weiter roh lesen.
 *
 * Design-Entscheidungen:
 *  - **Keine** Meta-Informationen im Standard-Fall. Wenn sie gebraucht
 *    werden, koennen sie als zweites Argument uebergeben werden.
 *  - **Kein** Top-Level `kind`-Diskriminator. Die HTTP-Route ist der
 *    Diskriminator (z. B. `/expenses/:id` vs `/incomes/:id`). Fruehere
 *    DELETE-Endpoints hatten `kind` im Body, weil die Route nicht
 *    diskriminierte — jetzt tut sie es (siehe Split-Endpoints).
 *  - **Type-Safe**: `defineApiResponse<T>(item)` hat Rueckgabe-Typ
 *    `ApiResponse<T>`, der Caller kann das `data`-Feld typsicher nutzen.
 */

export type ApiResponse<T> = {
  data: T
  meta?: Record<string, unknown>
}

/**
 * Wickelt ein Erfolgs-Objekt in den Standard-Envelope ein.
 *
 * @example
 *   return defineApiResponse({ kind: 'expense', item: expenseRow })
 *   // => { data: { kind: 'expense', item: expenseRow } }
 *
 * @example
 *   return defineApiResponse({ success: true }, { warning: 'soft delete' })
 *   // => { data: { success: true }, meta: { warning: 'soft delete' } }
 */
export function defineApiResponse<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  if (meta !== undefined) {
    return { data, meta }
  }
  return { data }
}