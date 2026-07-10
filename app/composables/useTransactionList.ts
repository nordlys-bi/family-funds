/*
 * useTransactionList — geteilter Data-Layer fuer die Transaktionslisten
 * (`/transactions/expenses` und `/transactions/income`, issue #9).
 *
 * Kapselt:
 *  - month-Filter-State (YYYY-MM, Default = aktueller Monat)
 *  - Lade-Logik gegen `GET /api/households/:id/transactions`
 *  - Transactions-Liste + Summary
 *  - Ableitungen: monthOptions, monthLabel, monthStart, monthEnd
 *
 * Beide Pages binden den Monats-Spinner an `month` und rufen `load()` nach
 * `month`-Wechsel. URL-Sync (?month=YYYY-MM) macht jede Page selbst via
 * useRoute/useRouter — Composable bleibt routing-agnostisch.
 */
import { computed, ref } from 'vue'
import { currentMonthYYYYMM, lastNMonths, formatMonthLabel, parseMonthRange, isValidMonthYYYYMM } from '../utils/month-filter'

export type TransactionKind = 'expense' | 'income'

export type TransactionItem = {
  id: string
  kind: TransactionKind
  amount: number
  description: string | null
  date: string
  createdAt?: string
  updatedAt?: string
  budgetId?: string | null
  budgetName?: string | null
  budgetKey?: string | null
  user: { displayName: string | null; email: string }
}

export type TransactionSummary = {
  incomeTotal: number
  expenseTotal: number
  netTotal: number
  unassignedExpenseTotal: number
}

const EMPTY_SUMMARY: TransactionSummary = {
  incomeTotal: 0,
  expenseTotal: 0,
  netTotal: 0,
  unassignedExpenseTotal: 0,
}

export type UseTransactionListOptions = {
  /** Initialer Monat (YYYY-MM). Default = aktueller Monat. */
  initialMonth?: string
  /** Anzahl Monate in den Select-Optionen. Default 12. */
  monthOptionCount?: number
}

export type UseTransactionListReturn = ReturnType<typeof useTransactionList>

export function useTransactionList(options: UseTransactionListOptions = {}) {
  // Page-scoped State via ref() — bewusst kein useState() mit globalem Key,
  // weil die beiden Listen (expenses/income) unabhaengige Filter-States haben
  // sollen. ref() im Composable ist page-lokal, weil der Composable im
  // setup() jeder Page neu instanziiert wird.
  const month = ref<string>(options.initialMonth && isValidMonthYYYYMM(options.initialMonth) ? options.initialMonth : currentMonthYYYYMM())
  const transactions = ref<TransactionItem[]>([])
  const summary = ref<TransactionSummary>({ ...EMPTY_SUMMARY })
  const loading = ref(false)
  const error = ref<string | null>(null)

  const monthOptions = computed(() => lastNMonths(options.monthOptionCount ?? 12))
  const monthLabel = computed(() => formatMonthLabel(month.value))
  const monthRange = computed(() => parseMonthRange(month.value))
  const monthStart = computed(() => monthRange.value?.start ?? null)
  const monthEnd = computed(() => monthRange.value?.end ?? null)

  /**
   * Filtert die geladenen Transaktionen nach `kind`. Pages rufen das
   * auf, um nur die fuer ihre Liste relevanten Items zu zeigen
   * (expense-Page blendet income-Items aus, und umgekehrt).
   */
  function transactionsByKind(kind: TransactionKind) {
    return transactions.value.filter((transaction) => transaction.kind === kind)
  }

  /**
   * Laedt Transaktionen + Summary fuer den aktuellen Monat gegen
   * `GET /api/households/:id/transactions?month=YYYY-MM`.
   *
   * @param householdId - aktiver Haushalt. Wenn `null`, wird der State
   *   auf leer zurueckgesetzt (z. B. wenn der User den Haushalt wechselt).
   */
  async function load(householdId: string | null | undefined) {
    if (!householdId) {
      transactions.value = []
      summary.value = { ...EMPTY_SUMMARY }
      error.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const response = await $fetch<{
        transactions: TransactionItem[]
        summary: TransactionSummary
        monthStart: string
        monthEnd: string
      }>(`/api/households/${householdId}/transactions`, {
        params: { month: month.value },
      })
      transactions.value = response.transactions
      summary.value = response.summary
    } catch (caught: any) {
      error.value = caught?.statusMessage ?? caught?.message ?? 'Unbekannter Fehler'
      transactions.value = []
      summary.value = { ...EMPTY_SUMMARY }
    } finally {
      loading.value = false
    }
  }

  /**
   * Setzt den Monat und loest ein Reload aus, wenn `householdId` gegeben ist.
   * Pages mit eigener Reload-Strategie (z. B. URL-Sync) koennen
   * `month.value = newMonth; await load(activeHouseholdId)` auch selbst
   * aufrufen — `setMonth` ist Convenience.
   */
  async function setMonth(nextMonth: string, householdId: string | null | undefined) {
    if (!isValidMonthYYYYMM(nextMonth)) {
      error.value = `Ungültiger Monat: ${nextMonth}`
      return
    }
    month.value = nextMonth
    await load(householdId)
  }

  /**
   * Optimistischer Update einer einzelnen Transaktion im lokalen State.
   * Liefert die Original-Transaktion zurueck, damit der Caller bei
   * einem Server-Fehler rollbacken kann (issue #15 Inline-Edit).
   *
   * Aktualisiert KEIN Summary-Aggregat — das wird per Reload oder
   * lokal im Caller nachgezogen, weil die Summary sich aus mehreren
   * Feldern zusammensetzt (kind, budgetId, amount) und eine lokal
   * gebaute Reduktion fehleranfaellig ist.
   */
  function updateTransactionLocal(
    id: string,
    patch: Partial<TransactionItem>,
  ): TransactionItem | null {
    const index = transactions.value.findIndex((transaction) => transaction.id === id)
    if (index === -1) return null
    const original = transactions.value[index]!
    transactions.value[index] = { ...original, ...patch }
    return original
  }

  /**
   * Rollback eines optimistischen Updates. Stellt die urspruengliche
   * Transaktion wieder her, wenn der Server-PATCH fehlschlaegt.
   */
  function restoreTransactionLocal(id: string, original: TransactionItem): void {
    const index = transactions.value.findIndex((transaction) => transaction.id === id)
    if (index === -1) return
    transactions.value[index] = original
  }

  /**
   * Entfernt eine Transaktion aus dem lokalen State (issue #58 Soft-Delete).
   * Liefert das entfernte Item inkl. Index zurueck, damit der Caller es
   * bei Undo oder Rollback wiederherstellen kann.
   *
   * Greift NICHT in den Server-State ein — der DELETE-Call gehoert in
   * den useUndoableDelete-Composable, der diesen Helper aufruft.
   */
  function removeTransactionLocal(id: string): { index: number; item: TransactionItem } | null {
    const index = transactions.value.findIndex((transaction) => transaction.id === id)
    if (index === -1) return null
    const item = transactions.value[index]!
    transactions.value = transactions.value.filter((transaction) => transaction.id !== id)
    return { index, item }
  }

  /**
   * Fuegt eine Transaktion an der richtigen Position in den lokalen
   * State ein (issue #58 Soft-Delete-Undo). Die Position wird anhand
   * des `date`-Felds bestimmt (desc), analog zur Server-Sortierung
   * in transactions.get.ts.
   */
  function insertTransactionLocal(item: TransactionItem, atIndex?: number): void {
    // Doppelinsert verhindern (z. B. wenn der Server-Refresh das Item
    // schon mitgebracht hat, waehrend der Undo noch laeuft).
    if (transactions.value.some((transaction) => transaction.id === item.id)) return

    if (typeof atIndex === 'number') {
      const next = transactions.value.slice()
      next.splice(atIndex, 0, item)
      transactions.value = next
      return
    }

    // Sort-Position ableiten: neues Item einfuegen, so dass `date DESC`
    // weiterhin gilt. Dafür reicht eine einfache binaere Suche, weil
    // die Liste klein ist (max. 500 laut Pagination-Limit).
    const itemTime = new Date(item.date).getTime()
    let low = 0
    let high = transactions.value.length
    while (low < high) {
      const mid = (low + high) >>> 1
      const midTime = new Date(transactions.value[mid]!.date).getTime()
      if (midTime > itemTime) {
        low = mid + 1
      } else {
        high = mid
      }
    }
    const next = transactions.value.slice()
    next.splice(low, 0, item)
    transactions.value = next
  }

  /**
   * Recompute Summary aus den aktuellen Transactions (issue #15
   * Optimistic-Update-Helper). Wird nach erfolgreichem Inline-Edit
   * aufgerufen, damit die Tags oben den neuen Wert zeigen ohne
   * full reload.
   */
  function recomputeSummaryFromLocal(): void {
    const expenses = transactions.value.filter((t) => t.kind === 'expense')
    const incomes = transactions.value.filter((t) => t.kind === 'income')
    const expenseTotal = expenses.reduce((sum, t) => sum + t.amount, 0)
    const incomeTotal = incomes.reduce((sum, t) => sum + t.amount, 0)
    const unassignedExpenseTotal = expenses
      .filter((t) => !t.budgetId)
      .reduce((sum, t) => sum + t.amount, 0)
    summary.value = {
      incomeTotal,
      expenseTotal,
      netTotal: incomeTotal - expenseTotal,
      unassignedExpenseTotal,
    }
  }

  return {
    month,
    monthOptions,
    monthLabel,
    monthStart,
    monthEnd,
    transactions,
    summary,
    loading,
    error,
    load,
    setMonth,
    transactionsByKind,
    updateTransactionLocal,
    restoreTransactionLocal,
    removeTransactionLocal,
    insertTransactionLocal,
    recomputeSummaryFromLocal,
  }
}
