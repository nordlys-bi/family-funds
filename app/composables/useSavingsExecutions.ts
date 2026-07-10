/*
 * useSavingsExecutions — Booking-Composable fuer Spar-Executions (issue #38).
 *
 * Kapselt den POST-Aufruf gegen
 * `POST /api/households/:id/savings-goals/:goalId/executions`.
 * Wird vom Sparziel-Detail (Cards in `savings.vue`) genutzt, um
 * Einzahlungen und Entnahmen zu buchen, ohne die Liste der Ziele
 * oder andere Pages zu beeinflussen.
 *
 * Bewusst KEIN useState() mit globalem Key — der Booking-State ist
 * page-lokal, weil er nur waehrend des Dialogs relevant ist. Beim
 * Schliessen des Dialogs wird der State verworfen.
 *
 * Optimistic-Update / Refresh-Strategie:
 *   - Diese Composable macht KEINEN lokalen State-Cache.
 *   - Stattdessen ruft der Caller nach erfolgreichem Buchen
 *     `loadPlanning()` (oder vergleichbar) auf, um die Liste der
 *     Goals inkl. aggregiertem Stand neu zu laden.
 *   - Begruendung: Die Aggregation (issue #12) wird server-seitig
 *     gemacht; ein client-seitiges Summieren ueber alle lokalen
 *     Executions wuerde gegen die Single-Source-of-Truth verstossen.
 */
import { ref } from 'vue'

export type ExecutionDirection = 'deposit' | 'withdraw'

export type BookExecutionPayload = {
  /** Betrag in EUR (positiv). Vorzeichen wird intern je nach `direction` gesetzt. */
  amount: number
  /** ISO-Datum (YYYY-MM-DD). Default 'heute' wird vom Caller gesetzt. */
  date: string
  /** Optionale Notiz, max 500 Zeichen (vom Server validiert). */
  note?: string
}

export type BookExecutionResult = {
  id: string
  savingsGoalId: string
  amount: number
  date: string
  note: string | null
}

export function useSavingsExecutions() {
  const posting = ref(false)
  const error = ref<string | null>(null)

  /**
   * Bucht eine neue Spar-Execution.
   *
   * @param householdId - aktiver Haushalt. Wenn `null`, wird der Call
   *   uebersprungen und ein Fehler gesetzt.
   * @param goalId - ID des Sparziels.
   * @param direction - 'deposit' (Einzahlung) oder 'withdraw' (Entnahme).
   *   Bestimmt das Vorzeichen des Betrags im API-Call.
   * @param payload - Betrag, Datum, optionale Notiz.
   * @returns Die erstellte Execution oder `null` bei Fehler.
   */
  async function bookExecution(
    householdId: string | null | undefined,
    goalId: string,
    direction: ExecutionDirection,
    payload: BookExecutionPayload,
  ): Promise<BookExecutionResult | null> {
    if (!householdId) {
      error.value = 'Kein aktiver Haushalt ausgewaehlt.'
      return null
    }
    if (!Number.isFinite(payload.amount) || payload.amount === 0) {
      error.value = 'Betrag muss ungleich 0 sein.'
      return null
    }
    posting.value = true
    error.value = null
    const signedAmount = direction === 'withdraw' ? -Math.abs(payload.amount) : Math.abs(payload.amount)
    try {
      const response = await $fetch<{ data: { kind: 'execution'; item: BookExecutionResult } }>(
        `/api/households/${householdId}/savings-goals/${goalId}/executions`,
        {
          method: 'POST',
          body: {
            amount: signedAmount,
            date: payload.date,
            note: payload.note,
          },
        },
      )
      return response.data.item
    } catch (caught: any) {
      error.value = caught?.statusMessage ?? caught?.message ?? 'Buchung fehlgeschlagen.'
      return null
    } finally {
      posting.value = false
    }
  }

  function clearError() {
    error.value = null
  }

  return {
    posting,
    error,
    bookExecution,
    clearError,
  }
}
