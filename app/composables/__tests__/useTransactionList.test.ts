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
 *  - `transactionsByKind('expense')` filtert nach kind
 *  - Person-/Budget-Filter gehen als Query-Params an den Server (issue #134)
 *  - `load(hh, { silent: true })` + Schutz vor veralteten Antworten
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

describe('useTransactionList — range (from/to) statt month', () => {
  it('startet ohne Range (range.value ist null)', () => {
    const list = useTransactionList()
    expect(list.range.value).toBeNull()
  })

  it('initialFrom setzt range direkt beim Erzeugen', () => {
    const list = useTransactionList({ initialFrom: '2026-09-14T12:00:00.000Z', initialTo: '2026-09-21T12:00:00.000Z' })
    expect(list.range.value).toEqual({ from: '2026-09-14T12:00:00.000Z', to: '2026-09-21T12:00:00.000Z' })
  })

  it('initialFrom ohne initialTo laesst to null (offene Periode)', () => {
    const list = useTransactionList({ initialFrom: '2026-09-14T12:00:00.000Z' })
    expect(list.range.value).toEqual({ from: '2026-09-14T12:00:00.000Z', to: null })
  })

  it('load() schickt from/to statt month, wenn range aktiv ist', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialFrom: '2026-09-14T12:00:00.000Z', initialTo: '2026-09-21T12:00:00.000Z' })
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { from: '2026-09-14T12:00:00.000Z', to: '2026-09-21T12:00:00.000Z' } }),
    )
  })

  it('load() laesst to weg, wenn die Periode offen ist', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialFrom: '2026-09-14T12:00:00.000Z' })
    await list.load('hh-1')
    const params = fetchMock.mock.calls[0][1].params
    expect(params).toEqual({ from: '2026-09-14T12:00:00.000Z' })
    expect(params.to).toBeUndefined()
  })

  it('setRange() setzt range und laedt neu', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.setRange('2026-09-14T12:00:00.000Z', '2026-09-21T12:00:00.000Z', 'hh-1')
    expect(list.range.value).toEqual({ from: '2026-09-14T12:00:00.000Z', to: '2026-09-21T12:00:00.000Z' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { from: '2026-09-14T12:00:00.000Z', to: '2026-09-21T12:00:00.000Z' } }),
    )
  })

  it('clearRange() faellt zurueck auf den month-Modus (ohne Reload)', async () => {
    fetchMock.mockResolvedValue({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    const list = useTransactionList({ initialMonth: '2026-05', initialFrom: '2026-09-14T12:00:00.000Z' })
    list.clearRange()
    expect(list.range.value).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/households/hh-1/transactions',
      expect.objectContaining({ params: { month: '2026-05' } }),
    )
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
 * Tests fuer die #55 Filter (Person + Budget), seit issue #134 Server-seitig.
 *
 * Wichtige Eigenschaften:
 *  - Die Filter gehen als `?userId=` / `?budgetId=` an den Server, damit
 *    Liste UND Summary (Badge) dieselben Filter sehen
 *  - `transactionsByKind` filtert nur noch nach kind — die Zeilen in
 *    `transactions` sind schon vom Server gefiltert
 *  - Die Setter laden nicht selbst; der Caller ruft danach `load()` (wie
 *    bei `setUnassignedOnly`)
 *  - Leere Strings werden zu null normalisiert (kein "leerer Filter")
 *  - `clearLocalFilters` leert nur die #55-Filter, nicht unassignedOnly
 *  - `hasLocalFilters` ist true sobald mindestens einer der beiden
 *    #55-Filter aktiv ist
 */
describe('useTransactionList — person/budget filters (issue #55, server-side since #134)', () => {
  const emptyResponse = {
    transactions: [],
    summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 },
  }

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

  it('sends userId and budgetId as fetch params when set', async () => {
    fetchMock.mockResolvedValue(emptyResponse)
    const list = useTransactionList({
      initialMonth: '2026-05',
      initialUserIdFilter: 'u-1',
      initialBudgetIdFilter: 'b-1',
    })
    await list.load('hh-1')
    const call = fetchMock.mock.calls[0]![1] as { params: Record<string, string> }
    expect(call.params).toEqual({ month: '2026-05', userId: 'u-1', budgetId: 'b-1' })
  })

  it('sends all filters together with a from/to range and unassigned', async () => {
    fetchMock.mockResolvedValue(emptyResponse)
    const list = useTransactionList({
      initialFrom: '2026-09-14T12:00:00.000Z',
      initialTo: '2026-09-21T12:00:00.000Z',
      initialUnassignedOnly: true,
      initialUserIdFilter: 'u-1',
    })
    await list.load('hh-1')
    const call = fetchMock.mock.calls[0]![1] as { params: Record<string, string> }
    expect(call.params).toEqual({
      from: '2026-09-14T12:00:00.000Z',
      to: '2026-09-21T12:00:00.000Z',
      unassigned: '1',
      userId: 'u-1',
    })
  })

  it('omits userId and budgetId when the filters are off', async () => {
    fetchMock.mockResolvedValue(emptyResponse)
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.load('hh-1')
    const call = fetchMock.mock.calls[0]![1] as { params: Record<string, string> }
    expect(call.params).toEqual({ month: '2026-05' })
  })

  it('uses the summary from the server as-is (issue #134: Badge = gefilterte Summe)', async () => {
    // Server hat nach userId gefiltert: die Summe (3000) passt zu den
    // gelieferten Zeilen, nicht zur Gesamtsumme des Monats.
    fetchMock.mockResolvedValue({
      transactions: [
        { id: 'e-1', kind: 'expense', amount: 1000, description: 'A', date: '2026-05-10', budgetId: 'b-1', user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
        { id: 'e-3', kind: 'expense', amount: 2000, description: 'C', date: '2026-05-05', budgetId: null, user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
      ],
      summary: { incomeTotal: 0, expenseTotal: 3000, netTotal: -3000, unassignedExpenseTotal: 2000 },
    })
    const list = useTransactionList({ initialUserIdFilter: 'u-1' })
    await list.load('hh-1')
    expect(list.summary.value.expenseTotal).toBe(3000)
    expect(list.summary.value.unassignedExpenseTotal).toBe(2000)
  })

  it('transactionsByKind filters by kind only — the server already applied person/budget', async () => {
    fetchMock.mockResolvedValue({
      transactions: [
        { id: 'e-1', kind: 'expense', amount: 100, description: 'A', date: '2026-05-10', budgetId: 'b-1', user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
        { id: 'i-1', kind: 'income', amount: 5000, description: 'Gehalt', date: '2026-05-01', user: { id: 'u-1', displayName: 'Jan', email: 'j@x' } },
      ],
      summary: { incomeTotal: 5000, expenseTotal: 100, netTotal: 4900, unassignedExpenseTotal: 0 },
    })
    // Filter-State passt bewusst NICHT zur Zeile (u-99 / b-99): ein
    // zusaetzlicher Client-Filter wuerde die Zeile hier wegschneiden.
    const list = useTransactionList({ initialUserIdFilter: 'u-99', initialBudgetIdFilter: 'b-99' })
    await list.load('hh-1')
    expect(list.transactionsByKind('expense').map((t) => t.id)).toEqual(['e-1'])
    expect(list.transactionsByKind('income').map((t) => t.id)).toEqual(['i-1'])
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

  it('setters do not fetch on their own; the next load() sends the changed params', async () => {
    fetchMock.mockResolvedValue(emptyResponse)
    const list = useTransactionList({ initialMonth: '2026-05' })
    await list.load('hh-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    list.setUserIdFilter('u-1')
    list.setBudgetIdFilter('b-1')
    // Der Caller (Page) laedt nach dem Setzen selbst neu — wie bei unassigned.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await list.load('hh-1')
    const second = fetchMock.mock.calls[1]![1] as { params: Record<string, string> }
    expect(second.params).toEqual({ month: '2026-05', userId: 'u-1', budgetId: 'b-1' })

    // Filter zuruecksetzen -> naechster Load ist wieder ungefiltert
    list.clearLocalFilters()
    await list.load('hh-1')
    const third = fetchMock.mock.calls[2]![1] as { params: Record<string, string> }
    expect(third.params).toEqual({ month: '2026-05' })
  })
})

/**
 * `load(hh, { silent: true })` (issue #134): Refresh der Summary nach
 * Inline-Edit / Loeschen / Wiederherstellen, ohne dass die Liste durch den
 * Lade-Zustand ausgeblendet wird. Plus: veraltete Antworten werden verworfen.
 */
describe('useTransactionList — silent reload + stale responses (issue #134)', () => {
  const row = (id: string, amount: number) => ({
    id,
    kind: 'expense' as const,
    amount,
    description: id,
    date: '2026-05-10',
    budgetId: 'b-1',
    user: { id: 'u-1', displayName: 'Jan', email: 'j@x' },
  })

  it('silent load does not toggle `loading`', async () => {
    let resolveFetch: (value: any) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))
    const list = useTransactionList()
    const promise = list.load('hh-1', { silent: true })
    expect(list.loading.value).toBe(false)
    resolveFetch({ transactions: [], summary: { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 } })
    await promise
    expect(list.loading.value).toBe(false)
  })

  it('silent load replaces the summary with the server value after a local edit', async () => {
    // Ursache 3 aus dem Issue: mehr Ausgaben als die Seite geladen hat.
    // Lokal summiert waere 1000 — die Server-Summe (99000) ist massgeblich.
    fetchMock.mockResolvedValueOnce({
      transactions: [row('e-1', 1000)],
      summary: { incomeTotal: 0, expenseTotal: 99000, netTotal: -99000, unassignedExpenseTotal: 0 },
    })
    const list = useTransactionList()
    await list.load('hh-1')

    list.updateTransactionLocal('e-1', { amount: 1500 })

    fetchMock.mockResolvedValueOnce({
      transactions: [row('e-1', 1500)],
      summary: { incomeTotal: 0, expenseTotal: 99500, netTotal: -99500, unassignedExpenseTotal: 0 },
    })
    await list.load('hh-1', { silent: true })
    expect(list.summary.value.expenseTotal).toBe(99500)
    expect(list.transactions.value[0]?.amount).toBe(1500)
  })

  it('silent load keeps list and summary on failure, but reports the error', async () => {
    fetchMock.mockResolvedValueOnce({
      transactions: [row('e-1', 1000)],
      summary: { incomeTotal: 0, expenseTotal: 1000, netTotal: -1000, unassignedExpenseTotal: 0 },
    })
    const list = useTransactionList()
    await list.load('hh-1')

    fetchMock.mockRejectedValueOnce(new Error('Netzwerk weg'))
    await list.load('hh-1', { silent: true })

    expect(list.error.value).toBe('Netzwerk weg')
    expect(list.transactions.value).toHaveLength(1)
    expect(list.summary.value.expenseTotal).toBe(1000)
  })

  it('a non-silent load failure still clears the list (unchanged behaviour)', async () => {
    fetchMock.mockResolvedValueOnce({
      transactions: [row('e-1', 1000)],
      summary: { incomeTotal: 0, expenseTotal: 1000, netTotal: -1000, unassignedExpenseTotal: 0 },
    })
    const list = useTransactionList()
    await list.load('hh-1')

    fetchMock.mockRejectedValueOnce(new Error('Netzwerk weg'))
    await list.load('hh-1')

    expect(list.transactions.value).toEqual([])
    expect(list.summary.value.expenseTotal).toBe(0)
  })

  it('discards a stale response that arrives after a newer load (Filter schnell gewechselt)', async () => {
    const resolvers: Array<(value: any) => void> = []
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const list = useTransactionList()

    list.setUserIdFilter('u-1')
    const first = list.load('hh-1')
    list.setUserIdFilter('u-2')
    const second = list.load('hh-1')

    // Die neuere Anfrage (u-2) antwortet zuerst, die aeltere (u-1) danach.
    resolvers[1]!({
      transactions: [row('e-u2', 200)],
      summary: { incomeTotal: 0, expenseTotal: 200, netTotal: -200, unassignedExpenseTotal: 0 },
    })
    await second
    resolvers[0]!({
      transactions: [row('e-u1', 100)],
      summary: { incomeTotal: 0, expenseTotal: 100, netTotal: -100, unassignedExpenseTotal: 0 },
    })
    await first

    expect(list.transactions.value.map((t) => t.id)).toEqual(['e-u2'])
    expect(list.summary.value.expenseTotal).toBe(200)
    expect(list.loading.value).toBe(false)
  })

  it('a stale failure does not clobber the newer result', async () => {
    const resolvers: Array<{ resolve: (value: any) => void; reject: (reason: unknown) => void }> = []
    fetchMock.mockImplementation(() => new Promise((resolve, reject) => { resolvers.push({ resolve, reject }) }))
    const list = useTransactionList()

    const first = list.load('hh-1')
    const second = list.load('hh-1')

    resolvers[1]!.resolve({
      transactions: [row('e-2', 200)],
      summary: { incomeTotal: 0, expenseTotal: 200, netTotal: -200, unassignedExpenseTotal: 0 },
    })
    await second
    resolvers[0]!.reject(new Error('alt und kaputt'))
    await first

    expect(list.error.value).toBeNull()
    expect(list.transactions.value).toHaveLength(1)
  })

  it('load(null) drops an in-flight response and resets loading', async () => {
    let resolveFetch: (value: any) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))
    const list = useTransactionList()

    const inFlight = list.load('hh-1')
    expect(list.loading.value).toBe(true)
    await list.load(null)
    expect(list.loading.value).toBe(false)

    resolveFetch({
      transactions: [row('e-1', 100)],
      summary: { incomeTotal: 0, expenseTotal: 100, netTotal: -100, unassignedExpenseTotal: 0 },
    })
    await inFlight

    expect(list.transactions.value).toEqual([])
    expect(list.summary.value.expenseTotal).toBe(0)
  })
})
