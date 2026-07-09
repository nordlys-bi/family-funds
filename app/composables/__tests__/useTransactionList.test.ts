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
