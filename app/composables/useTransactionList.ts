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
  }
}
