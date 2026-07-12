/*
 * useTransactionList — geteilter Data-Layer fuer die Transaktionslisten
 * (`/transactions/expenses` und `/transactions/income`, issue #9).
 *
 * Kapselt:
 *  - month-Filter-State (YYYY-MM, Default = aktueller Monat)
 *  - unassignedOnly-Filter (issue #52) — boolean, Default false
 *  - userIdFilter / budgetIdFilter (issue #55) — string|null, lokal angewendet
 *    auf die bereits geladene Monats-Liste (kein API-Roundtrip)
 *  - Lade-Logik gegen `GET /api/households/:id/transactions`
 *  - Transactions-Liste + Summary
 *  - Ableitungen: monthOptions, monthLabel, monthStart, monthEnd
 *
 * Beide Pages binden den Monats-Spinner an `month` und rufen `load()` nach
 * `month`-Wechsel. URL-Sync (?month, ?unassigned, ?userId, ?budgetId) macht
 * jede Page selbst via useRoute/useRouter — Composable bleibt routing-agnostisch.
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
  user: { id: string; displayName: string | null; email: string }
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
  /**
   * Initialer unassignedOnly-Filter (issue #52). Default false.
   * Die Page liest `route.query.unassigned` und übergibt das hier,
   * damit der Deep-Link ?unassigned=1 direkt greift.
   */
  initialUnassignedOnly?: boolean
  /**
   * Initialer Person-Filter (issue #55). User-ID des Haushalts-Mitglieds.
   * Wird lokal auf die geladene Liste angewendet, kein API-Roundtrip.
   * Default null = kein Filter.
   */
  initialUserIdFilter?: string | null
  /**
   * Initialer Budget-Filter (issue #55). Budget-ID des Haushalts.
   * Wird lokal auf die geladene Liste angewendet, kein API-Roundtrip.
   * Default null = kein Filter. Fuer Income-Listen nicht relevant
   * (Income-Transaktionen haben kein Budget), wird aber ignoriert
   * wenn keine Items ein passendes Budget haben.
   */
  initialBudgetIdFilter?: string | null
}

export type UseTransactionListReturn = ReturnType<typeof useTransactionList>

export function useTransactionList(options: UseTransactionListOptions = {}) {
  // Page-scoped State via ref() — bewusst kein useState() mit globalem Key,
  // weil die beiden Listen (expenses/income) unabhaengige Filter-States haben
  // sollen. ref() im Composable ist page-lokal, weil der Composable im
  // setup() jeder Page neu instanziiert wird.
  const month = ref<string>(options.initialMonth && isValidMonthYYYYMM(options.initialMonth) ? options.initialMonth : currentMonthYYYYMM())
  const unassignedOnly = ref<boolean>(Boolean(options.initialUnassignedOnly))
  // Issue #55: Person- und Budget-Filter. string = aktive ID, null = aus.
  // Werden LOKAL auf die bereits geladene Monats-Liste angewendet, kein
  // erneuter API-Call. Begruendung: der Server liefert bereits alle
  // Transaktionen des Haushalts fuer den Monat; die Filter sind eine
  // View-Sache, die das Neuladen nicht rechtfertigt.
  const userIdFilter = ref<string | null>(options.initialUserIdFilter ?? null)
  const budgetIdFilter = ref<string | null>(options.initialBudgetIdFilter ?? null)
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
   * Filtert die geladenen Transaktionen nach `kind` plus den aktiven
   * issue-#55-Filtern (userIdFilter, budgetIdFilter). Pages rufen das
   * auf, um nur die fuer ihre Liste relevanten Items zu zeigen
   * (expense-Page blendet income-Items aus, und umgekehrt).
   *
   * Filter-Reihenfolge:
   *  1. kind (expense/income) — Page-spezifisch
   *  2. userIdFilter — wenn gesetzt, nur Transaktionen dieses Users
   *  3. budgetIdFilter — wenn gesetzt, nur Transaktionen mit diesem Budget.
   *     Fuer Income-Listen bleibt der Filter typischerweise null
   *     (Income-Transaktionen haben kein Budget, der Filter wuerde
   *     immer alles aussortieren).
   *
   * Local-Filter, kein API-Call: der Server hat bereits alle Items
   * fuer den Monat geliefert, wir schneiden nur die Sicht zurecht.
   */
  function transactionsByKind(kind: TransactionKind) {
    return transactions.value.filter((transaction) => {
      if (transaction.kind !== kind) return false
      if (userIdFilter.value && transaction.user.id !== userIdFilter.value) return false
      if (budgetIdFilter.value && transaction.budgetId !== budgetIdFilter.value) return false
      return true
    })
  }

  /**
   * Laedt Transaktionen + Summary fuer den aktuellen Monat gegen
   * `GET /api/households/:id/transactions?month=YYYY-MM[&unassigned=1]`.
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
      // unassignedOnly-Param nur anhängen, wenn aktiv — Default-Reads
      // sollen sauber bleiben ("kein redundantes ?unassigned=0").
      const params: Record<string, string> = { month: month.value }
      if (unassignedOnly.value) params.unassigned = '1'
      const response = await $fetch<{
        transactions: TransactionItem[]
        summary: TransactionSummary
        monthStart: string
        monthEnd: string
      }>(`/api/households/${householdId}/transactions`, {
        params,
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
   * Setzt den unassignedOnly-Filter (issue #52). Bei Aktivierung wird
   * beim nächsten load() `?unassigned=1` an die API geschickt, was
   * serverseitig `budgetId: null` auf den Expense-Read setzt.
   *
   * Bewusst KEIN reload direkt hier — der Caller macht
   * `setUnassignedOnly(value, hhId); await load(hhId)` oder wartet
   * auf einen URL-Watch. Hält das Pattern konsistent mit setMonth.
   */
  function setUnassignedOnly(value: boolean) {
    unassignedOnly.value = Boolean(value)
  }

  /**
   * Setzt den Person-Filter (issue #55). String = aktive User-ID,
   * null = kein Filter. Wird lokal in `transactionsByKind` angewendet,
   * triggert keinen Reload — die Page macht URL-Sync + visuelle
   * Reaktion selbst. Konsistent mit `setUnassignedOnly`-Pattern.
   */
  function setUserIdFilter(value: string | null) {
    userIdFilter.value = value && value.length > 0 ? value : null
  }

  /**
   * Setzt den Budget-Filter (issue #55). String = aktive Budget-ID,
   * null = kein Filter. Lokale Anwendung, kein Reload. Fuer Income-
   * Pages typischerweise nie gesetzt (Income-Items haben kein Budget).
   */
  function setBudgetIdFilter(value: string | null) {
    budgetIdFilter.value = value && value.length > 0 ? value : null
  }

  /**
   * Leert ALLE issue-#55-Filter (Person + Budget) auf einmal.
   * Praktisch fuer "Alle anzeigen"-Buttons in der Empty-State.
   * unassignedOnly wird bewusst NICHT mitgenommen — das ist
   * semantisch ein separater Filter (issue #52), nicht ein #55-Filter.
   */
  function clearLocalFilters() {
    userIdFilter.value = null
    budgetIdFilter.value = null
  }

  /**
   * True wenn mindestens einer der #55-Local-Filter aktiv ist.
   * Praktisch fuer UI-Hints ("X von Y Buchungen werden angezeigt")
   * und Empty-State-Text-Varianten.
   */
  const hasLocalFilters = computed(
    () => userIdFilter.value !== null || budgetIdFilter.value !== null,
  )

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
    unassignedOnly,
    userIdFilter,
    budgetIdFilter,
    hasLocalFilters,
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
    setUnassignedOnly,
    setUserIdFilter,
    setBudgetIdFilter,
    clearLocalFilters,
    transactionsByKind,
    updateTransactionLocal,
    restoreTransactionLocal,
    removeTransactionLocal,
    insertTransactionLocal,
    recomputeSummaryFromLocal,
  }
}
