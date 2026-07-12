import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useTransactionList } from '../useTransactionList'

/**
 * Tests fuer `useTransactionList`.
 *
 * `$fetch` ist in Nuxt global verfuegbar, aber in der Vitest-node-Umgebung
 * nicht automatisch. Wir mocken es global per `vi.stubGlobal`.
 *
 * Composable-Logik, die hier abgedeckt wird:
 *  - Initial-State (Default = aktueller Monat, leere transactions)
 *  - `load(householdId)` macht GET mit `?month=YYYY-MM`
 *  - `load(null)` resettet State (Haushalt-Wechsel)
 *  - Error-Path: error.value wird gesetzt, transactions zurueckgesetzt
 *  - `setMonth(valid, hh)` aktualisiert month + reload
 *  - `setMonth(invalid, hh)` setzt error ohne reload
 *  - `transactionsByKind('expense')` filtert korrekt
 *  - `monthOptions` liefert 12 Monate
 */

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})

describe('useTransactionList — initial state', () => {
  it('defaults month to the current month', () => {
    const list = useTransactionList()
    expect(list.month.value).toMatch(/^\d{4}-\d{2}$/)
  })

  it('accepts an explicit initialMonth', () => {
    const list = useTransactionList({ initialMonth: '2026-03' })
    expect(list.month.value).toBe('2026-03')
  })

  it('falls back to current month when initialMonth is invalid', () => {
    const list = useTransactionList({ initialMonth: 'not-a-month' })
    expect(list.month.value).toMatch(/^\d{4}-\d{2}$/)
  })

  it('starts with empty transactions + zeroed summary', () => {
    const list = useTransactionList()
    expect(list.transactions.value).toEqual([])
    expect(list.summary.value).toEqual({
      incomeTotal: 0,
      expenseTotal: 0,
      netTotal: 0,
      unassignedExpenseTotal: 0,
    })
    expect(list.loading.value).toBe(false)
    expect(list.error.value).toBeNull()
  })

  it('exposes monthLabel as a human-readable German string', () => {
    const list = useTransactionList({ initialMonth: '2026-07' })
    expect(list.monthLabel.value).toBe('Juli 2026')
  })
})

describe('useTransactionList — monthOptions', () => {
  it('returns 12 options by default, newest first', () => {
    const list = useTransactionList()
    expect(list.monthOptions.value).toHaveLength(12)
    expect(list.monthOptions.value[0].value).toMatch(/^\d{4}-\d{2}$/)
    expect(list.monthOptions.value[0].label).toMatch(/^\w+ \d{4}$/)
  })

  it('respects a custom count', () => {
    const list = useTransactionList({ monthOptionCount: 3 })
    expect(list.monthOptions.value).toHaveLength(3)
  })
})

describe('useTransactionList — load()', () => {
  it('fetches with ?month=<current>', async () => {
    fetchMock.mockResolvedValue({
      transactions: [],
      summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 },
    })
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { month: '2026-05' } }),
    )
  })

  it('populates transactions and summary on success', async () => {
    fetchMock.mockResolvedValue({
      transactions: [
        { id: 'e-1', kind: 'expense', amount: 1000, description: 'X', date: '2026-05-10', user: { displayName: 'Jan', email: 'j@x' } },
        { id: 'i-1', kind: 'income', amount: 5000, description: 'Y', date: '2026-05-01', user: { displayName: 'Jan', email: 'j@x' } },
      ],
      summary: { incomeTotal: 5000, expenseTotal: 1000, netTotal: 4000, unassignedExpenseTotal: 1000 },
    })
    const list = useTransactionList()
    await list.load('hh-1')
    expect(list.transactions.value).toHaveLength(2)
    expect(list.summary.value.incomeTotal).toBe(5000)
    expect(list.loading.value).toBe(false)
    expect(list.error.value).toBeNull()
  })

  it('toggles loading during fetch', async () => {
    let resolveFetch: (value: any) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))
    const list = useTransactionList()
    const promise = list.load('hh-1')
    expect(list.loading.value).toBe(true)
    resolveFetch({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    await promise
    expect(list.loading.value).toBe(false)
  })

  it('resets state when householdId is null', async () => {
    fetchMock.mockResolvedValue({})
    const list = useTransactionList()
    list.transactions.value = [{ id: 'x', kind: 'expense', amount: 1, description: '', date: '', user: { displayName: null, email: '' } }]
    await list.load(null)
    expect(list.transactions.value).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('captures error.message on failure', async () => {
    fetchMock.mockRejectedValue(new Error('Network kaputt'))
    const list = useTransactionList()
    await list.load('hh-1')
    expect(list.error.value).toBe('Network kaputt')
    expect(list.transactions.value).toEqual([])
  })

  it('prefers statusMessage on h3-style errors', async () => {
    fetchMock.mockRejectedValue({ statusMessage: 'month must be in YYYY-MM format.' })
    const list = useTransactionList()
    await list.load('hh-1')
    expect(list.error.value).toBe('month must be in YYYY-MM format.')
  })
})

describe('useTransactionList — setMonth()', () => {
  it('updates month and triggers a reload', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList()
    await list.setMonth('2026-08', 'hh-1')
    expect(list.month.value).toBe('2026-08')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { month: '2026-08' } }),
    )
  })

  it('rejects invalid month format without reloading', async () => {
    fetchMock.mockResolvedValue({})
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.setMonth('2026-13', 'hh-1')
    expect(list.month.value).toBe('2026-05') // unchanged
    expect(list.error.value).toContain('2026-13')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useTransactionList — transactionsByKind()', () => {
  it('filters by expense kind', async () => {
    fetchMock.mockResolvedValue({
      transactions: [
        { id: 'e-1', kind: 'expense', amount: 100, description: '', date: '2026-05-10', user: { displayName: null, email: '' } },
        { id: 'i-1', kind: 'income', amount: 500, description: '', date: '2026-05-01', user: { displayName: null, email: '' } },
      ],
      summary: { incomeTotal: 500, expenseTotal: 100, netTotal: 400, unassignedExpenseTotal: 100 },
    })
    const list = useTransactionList()
    await list.load('hh-1')
    expect(list.transactionsByKind('expense')).toHaveLength(1)
    expect(list.transactionsByKind('expense')[0].id).toBe('e-1')
    expect(list.transactionsByKind('income')).toHaveLength(1)
    expect(list.transactionsByKind('income')[0].id).toBe('i-1')
  })
})

describe('useTransactionList — unassignedOnly filter (issue #52)', () => {
  it('defaults unassignedOnly to false', () => {
    const list = useTransactionList()
    expect(list.unassignedOnly.value).toBe(false)
  })

  it('respects an explicit initialUnassignedOnly', () => {
    const list = useTransactionList({ initialUnassignedOnly: true })
    expect(list.unassignedOnly.value).toBe(true)
  })

  it('coerces non-boolean initialUnassignedOnly to false', () => {
    // Edge case: route.query.unassigned === '1' waere ein String, nicht
    // ein Boolean. Page-Code muss '1' selbst mappen — Composable
    // erwartet explizit boolean und coerced sicherheitshalber.
    const list = useTransactionList({ initialUnassignedOnly: '1' as unknown as boolean })
    expect(list.unassignedOnly.value).toBe(true)
  })

  it('does not add unassigned param to fetch when unassignedOnly is false', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { month: '2026-05' } }),
    )
    const call = fetchMock.mock.calls[0][1] as { params: Record<string, string> }
    expect(call.params.unassigned).toBeUndefined()
  })

  it('adds unassigned=1 to fetch when unassignedOnly is true', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialMonth: '2026-05', initialUnassignedOnly: true })
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { month: '2026-05', unassigned: '1' } }),
    )
  })

  it('setUnassignedOnly updates the flag and a subsequent load sends the new param', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialMonth: '2026-05' })
    // Initial: kein unassigned
    await list.load('hh-1')
    expect(list.unassignedOnly.value).toBe(false)

    // Aktivieren, neu laden
    list.setUnassignedOnly(true)
    expect(list.unassignedOnly.value).toBe(true)
    await list.load('hh-1')
    const secondCall = fetchMock.mock.calls[1][1] as { params: Record<string, string> }
    expect(secondCall.params.unassigned).toBe('1')

    // Deaktivieren, neu laden
    list.setUnassignedOnly(false)
    expect(list.unassignedOnly.value).toBe(false)
    await list.load('hh-1')
    const thirdCall = fetchMock.mock.calls[2][1] as { params: Record<string, string> }
    expect(thirdCall.params.unassigned).toBeUndefined()
  })

  it('coerces non-boolean values in setUnassignedOnly', () => {
    const list = useTransactionList()
    list.setUnassignedOnly('true' as unknown as boolean)
    expect(list.unassignedOnly.value).toBe(true)
    list.setUnassignedOnly(0 as unknown as boolean)
    expect(list.unassignedOnly.value).toBe(false)
  })
})

/**
 * Tests fuer die #55 Local-Filter (Person + Budget).
 *
 * Wichtige Eigenschaften:
 *  - Local-Filter triggern KEINEN API-Roundtrip (die Monats-Liste ist
 *    bereits geladen, wir schneiden nur die Sicht zurecht)
 *  - `transactionsByKind` wendet kind + userId + budgetId in dieser
 *    Reihenfolge an
 *  - Leere Strings werden zu null normalisiert (kein "leerer Filter")
 *  - `clearLocalFilters` leert nur die #55-Filter, nicht unassignedOnly
 *  - `hasLocalFilters` ist true sobald mindestens einer der beiden
 *    #55-Filter aktiv ist
 */
describe('useTransactionList — local filters (issue #55)', () => {
  const sampleTransactions = [
    { id: 'e-1', kind: 'expense' as const, amount: 100, description: 'A', date: '2026-05-10', budgetId: 'b-1', user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
    { id: 'e-2', kind: 'expense' as const, amount: 200, description: 'B', date: '2026-05-08', budgetId: 'b-2', user: { id: 'u-2', displayName: 'Maria', email: 'm@x' } },
    { id: 'e-3', kind: 'expense' as const, amount: 300, description: 'C', date: '2026-05-05', budgetId: null, user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
    { id: 'i-1', kind: 'income' as const, amount: 5000, description: 'Gehalt', date: '2026-05-01', user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
  ]

  it('defaults userIdFilter and budgetIdFilter to null', () => {
    const list = useTransactionList()
    expect(list.userIdFilter.value).toBeNull()
    expect(list.budgetIdFilter.value).toBeNull()
    expect(list.hasLocalFilters.value).toBe(false)
  })

  it('accepts initial values for both filters', () => {
    const list = useTransactionList({
      initialUserIdFilter: 'u-1',
      initialBudgetIdFilter: 'b-1',
    })
    expect(list.userIdFilter.value).toBe('u-1')
    expect(list.budgetIdFilter.value).toBe('b-1')
    expect(list.hasLocalFilters.value).toBe(true)
  })

  it('does NOT add userId or budgetId to the fetch params (local-only filter)', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({
      initialMonth: '2026-05',
      initialUserIdFilter: 'u-1',
      initialBudgetIdFilter: 'b-1',
    })
    await list.load('hh-1')
    const call = fetchMock.mock.calls[0][1] as { params: Record<string, string> }
    expect(call.params).toEqual({ month: '2026-05' })
    expect(call.params.userId).toBeUndefined()
    expect(call.params.budgetId).toBeUndefined()
  })

  it('filters transactionsByKind by userId when set', async () => {
    fetchMock.mockResolvedValue({
      transactions: sampleTransactions,
      summary: { incomeTotal: 5000, expenseTotal: 600, netTotal: 4400, unassignedExpenseTotal: 300 },
    })
    const list = useTransactionList({ initialUserIdFilter: 'u-1' })
    await list.load('hh-1')
    const janExpenses = list.transactionsByKind('expense')
    expect(janExpenses).toHaveLength(2)
    expect(janExpenses.every((t) => t.user.id === 'u-1')).toBe(true)
  })

  it('filters transactionsByKind by budgetId when set', async () => {
    fetchMock.mockResolvedValue({
      transactions: sampleTransactions,
      summary: { incomeTotal: 5000, expenseTotal: 600, netTotal: 4400, unassignedExpenseTotal: 300 },
    })
    const list = useTransactionList({ initialBudgetIdFilter: 'b-1' })
    await list.load('hh-1')
    // Nur die eine Transaktion mit budgetId=b-1. income-Items ohne
    // budgetId werden durch den Filter ebenfalls ausgeschlossen
    // (weil budgetId null !== 'b-1').
    const matched = list.transactionsByKind('expense')
    expect(matched).toHaveLength(1)
    expect(matched[0].id).toBe('e-1')
  })

  it('combines userId and budgetId filters (AND)', async () => {
    fetchMock.mockResolvedValue({
      transactions: sampleTransactions,
      summary: { incomeTotal: 5000, expenseTotal: 600, netTotal: 4400, unassignedExpenseTotal: 300 },
    })
    const list = useTransactionList({ initialUserIdFilter: 'u-1', initialBudgetIdFilter: 'b-1' })
    await list.load('hh-1')
    const matched = list.transactionsByKind('expense')
    expect(matched).toHaveLength(1)
    expect(matched[0].id).toBe('e-1')
  })

  it('returns empty list when userId does not match', async () => {
    fetchMock.mockResolvedValue({
      transactions: sampleTransactions,
      summary: { incomeTotal: 5000, expenseTotal: 600, netTotal: 4400, unassignedExpenseTotal: 300 },
    })
    const list = useTransactionList({ initialUserIdFilter: 'u-99' })
    await list.load('hh-1')
    expect(list.transactionsByKind('expense')).toHaveLength(0)
  })

  it('setUserIdFilter / setBudgetIdFilter update state', () => {
    const list = useTransactionList()
    list.setUserIdFilter('u-1')
    expect(list.userIdFilter.value).toBe('u-1')
    expect(list.hasLocalFilters.value).toBe(true)

    list.setBudgetIdFilter('b-1')
    expect(list.budgetIdFilter.value).toBe('b-1')

    list.setUserIdFilter(null)
    expect(list.userIdFilter.value).toBeNull()
    expect(list.hasLocalFilters.value).toBe(true) // budgetIdFilter ist noch aktiv

    list.setBudgetIdFilter(null)
    expect(list.budgetIdFilter.value).toBeNull()
    expect(list.hasLocalFilters.value).toBe(false)
  })

  it('normalizes empty string to null in setters', () => {
    const list = useTransactionList()
    list.setUserIdFilter('')
    expect(list.userIdFilter.value).toBeNull()
    list.setBudgetIdFilter('')
    expect(list.budgetIdFilter.value).toBeNull()
  })

  it('clearLocalFilters clears both #55 filters but NOT unassignedOnly', () => {
    const list = useTransactionList({
      initialUserIdFilter: 'u-1',
      initialBudgetIdFilter: 'b-1',
      initialUnassignedOnly: true,
    })
    expect(list.hasLocalFilters.value).toBe(true)
    expect(list.unassignedOnly.value).toBe(true)

    list.clearLocalFilters()

    expect(list.userIdFilter.value).toBeNull()
    expect(list.budgetIdFilter.value).toBeNull()
    expect(list.hasLocalFilters.value).toBe(false)
    // unassignedOnly ist semantisch ein separater Filter (issue #52),
    // nicht ein #55-Filter — bleibt unberuehrt.
    expect(list.unassignedOnly.value).toBe(true)
  })

  it('hasLocalFilters tracks both filters independently', () => {
    const list = useTransactionList()
    expect(list.hasLocalFilters.value).toBe(false)

    list.setUserIdFilter('u-1')
    expect(list.hasLocalFilters.value).toBe(true)

    list.setUserIdFilter(null)
    list.setBudgetIdFilter('b-1')
    expect(list.hasLocalFilters.value).toBe(true)

    list.setBudgetIdFilter(null)
    expect(list.hasLocalFilters.value).toBe(false)
  })

  it('does not refetch when local filters change', async () => {
    fetchMock.mockResolvedValue({
      transactions: sampleTransactions,
      summary: { incomeTotal: 5000, expenseTotal: 600, netTotal: 4400, unassignedExpenseTotal: 300 },
    })
    const list = useTransactionList()
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    list.setUserIdFilter('u-1')
    list.setBudgetIdFilter('b-1')
    // Kein weiterer API-Call, weil die Filter nur die View zurechtschneiden.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // transactionsByKind sieht die gefilterte View, ohne dass load() noetig war.
    expect(list.transactionsByKind('expense')).toHaveLength(1)
  })
})
