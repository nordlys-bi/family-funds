import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSavingsExecutions } from '../useSavingsExecutions'

/*
 * Tests fuer `useSavingsExecutions` (issue #38).
 *
 * Composable kapselt den POST gegen
 * `/api/households/:id/savings-goals/:goalId/executions`.
 * `$fetch` wird per `vi.stubGlobal` gemockt, weil Nuxt es in der
 * Vitest-node-Umgebung nicht automatisch bereitstellt.
 *
 * Composable-Logik, die hier abgedeckt wird:
 *  - Happy-Path: positive Einzahlung wird mit `+amount` gepostet.
 *  - Happy-Path: Entnahme wird mit `-amount` (abs) gepostet.
 *  - Notiz wird mitgesendet.
 *  - Validierung: Betrag 0 setzt error, ohne API-Call.
 *  - Validierung: kein householdId setzt error, ohne API-Call.
 *  - Error-Path: Server-Fehler (4xx) wird in error.value abgebildet.
 *  - `clearError` setzt error zurueck.
 */

const fetchMock = vi.fn()

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeExecutionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-new',
    savingsGoalId: GOAL_ID,
    amount: 50,
    date: '2026-07-15T00:00:00.000Z',
    note: null,
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})

describe('useSavingsExecutions — bookExecution deposit', () => {
  it('POSTs with positive amount when direction is deposit', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow({ amount: 50 }) } })
    const { bookExecution } = useSavingsExecutions()

    const result = await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 50, date: '2026-07-15' })

    expect(result).toMatchObject({ id: 'exec-new', amount: 50 })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/households/${HH_ID}/savings-goals/${GOAL_ID}/executions`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ amount: 50, date: '2026-07-15' }),
      }),
    )
  })
})

describe('useSavingsExecutions — bookExecution withdraw', () => {
  it('POSTs with negative amount (absolute) when direction is withdraw', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow({ amount: -25 }) } })
    const { bookExecution } = useSavingsExecutions()

    const result = await bookExecution(HH_ID, GOAL_ID, 'withdraw', { amount: 25, date: '2026-07-15' })

    expect(result).toMatchObject({ amount: -25 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ amount: -25 }),
      }),
    )
  })

  it('normalizes negative input to positive absolute before applying sign', async () => {
    // Falls der Caller versehentlich -25 schickt: wir wollen auf der
    // API-Seite trotzdem -25 sehen, nicht 25.
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow({ amount: -25 }) } })
    const { bookExecution } = useSavingsExecutions()

    await bookExecution(HH_ID, GOAL_ID, 'withdraw', { amount: -25, date: '2026-07-15' })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ amount: -25 }),
      }),
    )
  })
})

describe('useSavingsExecutions — note passthrough', () => {
  it('sends the note when provided', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow({ note: 'Urlaub Q3' }) } })
    const { bookExecution } = useSavingsExecutions()

    await bookExecution(HH_ID, GOAL_ID, 'deposit', {
      amount: 100,
      date: '2026-07-15',
      note: 'Urlaub Q3',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ note: 'Urlaub Q3' }),
      }),
    )
  })

  it('passes undefined note when not provided (server treats as no-note)', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow() } })
    const { bookExecution } = useSavingsExecutions()

    await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })

    const callArgs = fetchMock.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(callArgs.body).toHaveProperty('note', undefined)
  })
})

describe('useSavingsExecutions — validation', () => {
  it('rejects amount = 0 without making an API call', async () => {
    const { bookExecution, error } = useSavingsExecutions()

    const result = await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 0, date: '2026-07-15' })

    expect(result).toBeNull()
    expect(error.value).toMatch(/ungleich 0/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects missing householdId without making an API call', async () => {
    const { bookExecution, error } = useSavingsExecutions()

    const result = await bookExecution(null, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })

    expect(result).toBeNull()
    expect(error.value).toMatch(/Haushalt/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useSavingsExecutions — error handling', () => {
  it('captures the server error message in error.value', async () => {
    fetchMock.mockRejectedValue({
      statusMessage: 'Execution not found in this goal/household.',
      statusCode: 404,
    })
    const { bookExecution, error, posting } = useSavingsExecutions()

    const result = await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })

    expect(result).toBeNull()
    expect(error.value).toBe('Execution not found in this goal/household.')
    expect(posting.value).toBe(false)
  })

  it('falls back to a generic message when the server has no statusMessage', async () => {
    fetchMock.mockRejectedValue(new Error('Network down'))
    const { bookExecution, error } = useSavingsExecutions()

    await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })

    expect(error.value).toBe('Network down')
  })

  it('clearError() resets error.value', async () => {
    fetchMock.mockRejectedValue(new Error('Boom'))
    const { bookExecution, clearError, error } = useSavingsExecutions()

    await bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })
    expect(error.value).not.toBeNull()

    clearError()
    expect(error.value).toBeNull()
  })
})

describe('useSavingsExecutions — posting flag', () => {
  it('flips posting to true during the call and back to false after', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const { bookExecution, posting } = useSavingsExecutions()

    const pending = bookExecution(HH_ID, GOAL_ID, 'deposit', { amount: 10, date: '2026-07-15' })
    expect(posting.value).toBe(true)

    resolveFetch({ data: { kind: 'execution', item: makeExecutionRow() } })
    await pending
    expect(posting.value).toBe(false)
  })
})
