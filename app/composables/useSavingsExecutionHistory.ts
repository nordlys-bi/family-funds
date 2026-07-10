/*
 * useSavingsExecutionHistory — Read-Composable fuer Spar-Execution-History
 * (issue #39).
 *
 * Kapselt den GET gegen
 * `GET /api/households/:id/savings-goals/:goalId/executions?limit=N`.
 * Wird vom History-Dialog auf der Sparziel-Seite genutzt.
 *
 * State ist page-lokal (kein useState mit globalem Key) — der
 * History-Dialog ist ein transienter View, dessen State beim
 * Schliessen des Dialogs verworfen wird.
 *
 * Pagination-Pattern: Initial-Load 20, "Mehr laden" holt die naechsten
 * 20 (konstanter Page-Size). `hasMore` wird aus dem Response-Inhalt
 * abgeleitet (genauso wie bei den Transaktions-Listen, siehe
 * `useTransactionList`).
 */
import { computed, ref } from 'vue'

const PAGE_SIZE = 20

export type ExecutionHistoryItem = {
  id: string
  savingsGoalId: string
  amount: number // Cent
  date: string // ISO
  note: string | null
  createdAt: string
  updatedAt: string
}

export type UseSavingsExecutionHistoryOptions = {
  /** Initialer Page-Size. Default 20. */
  pageSize?: number
}

export function useSavingsExecutionHistory(
  householdId: () => string | null | undefined,
  goalId: () => string | null | undefined,
  options: UseSavingsExecutionHistoryOptions = {},
) {
  const pageSize = options.pageSize ?? PAGE_SIZE

  const items = ref<ExecutionHistoryItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  /** True wenn der letzte Load eine volle Page geliefert hat
   *  (es koennte also weitere Items geben). */
  const hasMore = computed(() => items.value.length > 0 && items.value.length % pageSize === 0)

  /**
   * Laedt die ersten `pageSize` Eintraege. Ersetzt vorhandene Items.
   * Wird beim Oeffnen des History-Dialogs aufgerufen.
   */
  async function load() {
    const hhId = householdId()
    const gId = goalId()
    if (!hhId || !gId) {
      items.value = []
      loaded.value = true
      return
    }
    loading.value = true
    error.value = null
    try {
      const response = await $fetch<{
        data: { kind: 'executions'; items: ExecutionHistoryItem[] }
      }>(`/api/households/${hhId}/savings-goals/${gId}/executions`, {
        params: { limit: pageSize },
      })
      items.value = response.data.items
      loaded.value = true
    } catch (caught: any) {
      error.value = caught?.statusMessage ?? caught?.message ?? 'History konnte nicht geladen werden.'
      items.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Laedt die naechste Page und haengt sie an `items` an. Setzt
   * `error`, falls der Server mehr als eine volle Page zurueckgibt
   * (dann ist `hasMore` wieder true) — wir wollen kein doppeltes
   * Appenden bei inkonsistenten Daten.
   */
  async function loadMore() {
    const hhId = householdId()
    const gId = goalId()
    if (!hhId || !gId) return
    if (loading.value) return
    if (!hasMore.value) return
    loading.value = true
    error.value = null
    try {
      const response = await $fetch<{
        data: { kind: 'executions'; items: ExecutionHistoryItem[] }
      }>(`/api/households/${hhId}/savings-goals/${gId}/executions`, {
        params: { limit: pageSize, offset: items.value.length },
      })
      items.value = [...items.value, ...response.data.items]
    } catch (caught: any) {
      error.value = caught?.statusMessage ?? caught?.message ?? 'Mehr Eintraege konnten nicht geladen werden.'
    } finally {
      loading.value = false
    }
  }

  /** Reload von vorne (z. B. nach einer neuen Buchung). */
  async function refresh() {
    await load()
  }

  function reset() {
    items.value = []
    loaded.value = false
    error.value = null
  }

  return {
    items,
    loading,
    error,
    loaded,
    hasMore,
    load,
    loadMore,
    refresh,
    reset,
  }
}
