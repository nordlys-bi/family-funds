/*
 * useTransactionList — geteilter Data-Layer fuer die Transaktionslisten
 * (`/transactions/expenses` und `/transactions/income`, issue #9).
 *
 * Kapselt:
 *  - month-Filter-State (YYYY-MM, Default = aktueller Monat)
 *  - unassignedOnly-Filter (issue #52) — boolean, Default false
 *  - userIdFilter / budgetIdFilter (issue #55) — string|null. Werden als
 *    `?userId=` / `?budgetId=` an den Server geschickt (issue #134), damit
 *    Liste UND Summary dieselben Filter sehen — siehe `load()`.
 *  - Lade-Logik gegen `GET /api/households/:id/transactions`
 *  - Transactions-Liste + Summary (Summary kommt immer vom Server)
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
   * Wird als `?userId=` an den Server geschickt (issue #134).
   * Default null = kein Filter.
   */
  initialUserIdFilter?: string | null
  /**
   * Initialer Budget-Filter (issue #55). Budget-ID des Haushalts.
   * Wird als `?budgetId=` an den Server geschickt (issue #134).
   * Default null = kein Filter. Fuer Income-Listen nicht relevant
   * (Income-Transaktionen haben kein Budget, der Server ignoriert den
   * Filter dort).
   */
  initialBudgetIdFilter?: string | null
  /**
   * Expliziter Zeitraum (ISO-8601-Strings), z. B. von einem Klick auf
   * eine Dashboard-Budget-Karte (periodStart/periodEnd). Hat Vorrang vor
   * `month`, solange gesetzt — fuer Perioden, die nicht auf Kalendermonate
   * passen (WEEKLY/QUARTERLY/YEARLY/ONCE). `to` fehlt bei einer offenen
   * ONCE-Periode. Ueber `setRange`/`clearRange` wieder verlassbar.
   */
  initialFrom?: string
  initialTo?: string | null
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
  // Seit issue #134 filtert der SERVER (`?userId=` / `?budgetId=`), nicht
  // mehr der Client: nur so passen die Summary-Aggregates (Badge) zur
  // gefilterten Liste, auch wenn die Liste paginiert ist. Ein Filterwechsel
  // braucht deshalb ein `load()` durch den Caller (wie bei unassignedOnly).
  const userIdFilter = ref<string | null>(options.initialUserIdFilter ?? null)
  const budgetIdFilter = ref<string | null>(options.initialBudgetIdFilter ?? null)
  // Expliziter Zeitraum statt Monat (siehe UseTransactionListOptions.initialFrom).
  // `null` = normaler Monats-Modus.
  const range = ref<{ from: string; to: string | null } | null>(
    options.initialFrom ? { from: options.initialFrom, to: options.initialTo ?? null } : null,
  )
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
   *
   * Person-/Budget-/Unassigned-Filter wendet der Server an (issue #134) —
   * `transactions` enthaelt schon nur passende Zeilen. Ein zusaetzlicher
   * Client-Filter waere nicht nur redundant, sondern wuerde bei Aenderungen
   * am Filter zwischen zwei `load()`-Calls zu einer Liste fuehren, die nicht
   * zur (Server-)Summary passt.
   */
  function transactionsByKind(kind: TransactionKind) {
    return transactions.value.filter((transaction) => transaction.kind === kind)
  }

  // Laufende Nummer des juengsten load()-Calls. Filter- und Monatswechsel
  // koennen mehrere Requests ueberlappen; eine spaet eintreffende, veraltete
  // Antwort darf Liste + Summary nicht mit den Werten eines frueheren Filters
  // ueberschreiben (die Badge wuerde sonst wieder nicht zur Liste passen).
  let latestLoad = 0

  /**
   * Laedt Transaktionen + Summary fuer den aktuellen Zeitraum gegen
   * `GET /api/households/:id/transactions?month=YYYY-MM[&unassigned=1]
   * [&userId=…][&budgetId=…]` — alle aktiven Filter gehen an den Server,
   * damit `summary` zur Liste passt (issue #134).
   *
   * @param householdId - aktiver Haushalt. Wenn `null`, wird der State
   *   auf leer zurueckgesetzt (z. B. wenn der User den Haushalt wechselt).
   * @param options.silent - Refresh im Hintergrund: `loading` bleibt aus
   *   (die Liste wird nicht durch den Lade-Zustand ausgeblendet) und bei
   *   einem Fehler bleibt der bisherige State stehen, nur `error` wird
   *   gesetzt. Gedacht fuer das Nachziehen der Summary nach Inline-Edit,
   *   Loeschen und Wiederherstellen.
   */
  async function load(householdId: string | null | undefined, options: { silent?: boolean } = {}) {
    const requestId = ++latestLoad
    if (!householdId) {
      transactions.value = []
      summary.value = { ...EMPTY_SUMMARY }
      error.value = null
      loading.value = false
      return
    }
    if (!options.silent) loading.value = true
    error.value = null
    try {
      // unassignedOnly-Param nur anhängen, wenn aktiv — Default-Reads
      // sollen sauber bleiben ("kein redundantes ?unassigned=0").
      // Zeitraum: `range` (explizites from/to) hat Vorrang vor `month`.
      const params: Record<string, string> = range.value
        ? { from: range.value.from, ...(range.value.to ? { to: range.value.to } : {}) }
        : { month: month.value }
      if (unassignedOnly.value) params.unassigned = '1'
      if (userIdFilter.value) params.userId = userIdFilter.value
      if (budgetIdFilter.value) params.budgetId = budgetIdFilter.value
      const response = await $fetch<{
        transactions: TransactionItem[]
        summary: TransactionSummary
        monthStart: string
        monthEnd: string
      }>(`/api/households/${householdId}/transactions`, {
        params,
      })
      if (requestId !== latestLoad) return
      transactions.value = response.transactions
      summary.value = response.summary
    } catch (caught: any) {
      if (requestId !== latestLoad) return
      error.value = caught?.statusMessage ?? caught?.message ?? 'Unbekannter Fehler'
      if (!options.silent) {
        transactions.value = []
        summary.value = { ...EMPTY_SUMMARY }
      }
    } finally {
      if (requestId === latestLoad) loading.value = false
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
   * Setzt den expliziten Zeitraum-Filter und loest ein Reload aus. Ersetzt
   * `month` als Quelle fuer den naechsten `load()`-Aufruf, solange aktiv.
   * `to` weglassen fuer eine offene Periode (ONCE ohne Nachfolge-Version).
   */
  async function setRange(from: string, to: string | null, householdId: string | null | undefined) {
    range.value = { from, to }
    await load(householdId)
  }

  /**
   * Verlaesst den Zeitraum-Modus und faellt zurueck auf den aktuellen
   * `month`-Wert (kein Reload hier — der Caller entscheidet, ob er
   * direkt neu laedt oder erst die URL synct, analog zu `setMonth`).
   */
  function clearRange() {
    range.value = null
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
   * null = kein Filter. Beim naechsten `load()` geht er als `?userId=` an
   * den Server (issue #134). Triggert bewusst keinen Reload selbst — der
   * Caller macht `setUserIdFilter(v); await load(hhId)` plus URL-Sync,
   * konsistent mit `setUnassignedOnly`.
   */
  function setUserIdFilter(value: string | null) {
    userIdFilter.value = value && value.length > 0 ? value : null
  }

  /**
   * Setzt den Budget-Filter (issue #55). String = aktive Budget-ID,
   * null = kein Filter. Gleiches Pattern wie `setUserIdFilter`: Caller
   * laedt neu. Fuer Income-Pages typischerweise nie gesetzt (Income-Items
   * haben kein Budget).
   */
  function setBudgetIdFilter(value: string | null) {
    budgetIdFilter.value = value && value.length > 0 ? value : null
  }

  /**
   * Leert ALLE issue-#55-Filter (Person + Budget) auf einmal.
   * Praktisch fuer "Alle anzeigen"-Buttons in der Empty-State.
   * unassignedOnly wird bewusst NICHT mitgenommen — das ist
   * semantisch ein separater Filter (issue #52), nicht ein #55-Filter.
   * Kein Reload — der Caller laedt danach neu.
   *
   * (Historischer Name: "Local" hiess, dass die Filter nur clientseitig
   * wirkten; seit issue #134 filtert der Server.)
   */
  function clearLocalFilters() {
    userIdFilter.value = null
    budgetIdFilter.value = null
  }

  /**
   * True wenn mindestens einer der #55-Filter (Person/Budget) aktiv ist.
   * Praktisch fuer Empty-State-Text-Varianten.
   */
  const hasLocalFilters = computed(
    () => userIdFilter.value !== null || budgetIdFilter.value !== null,
  )

  /**
   * Optimistischer Update einer einzelnen Transaktion im lokalen State.
   * Liefert die Original-Transaktion zurueck, damit der Caller bei
   * einem Server-Fehler rollbacken kann (issue #15 Inline-Edit).
   *
   * Aktualisiert KEIN Summary-Aggregat — der Caller zieht sie per
   * `load(hhId, { silent: true })` vom Server nach (issue #134), weil die
   * Summary von Filtern, Pagination und mehreren Feldern (kind, budgetId,
   * amount) abhaengt und eine lokal gebaute Reduktion davon abweichen kann.
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

  return {
    month,
    range,
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
    setRange,
    clearRange,
    setUnassignedOnly,
    setUserIdFilter,
    setBudgetIdFilter,
    clearLocalFilters,
    transactionsByKind,
    updateTransactionLocal,
    restoreTransactionLocal,
    removeTransactionLocal,
    insertTransactionLocal,
  }
}
