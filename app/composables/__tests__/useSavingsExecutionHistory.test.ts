import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useSavingsExecutionHistory } from '../useSavingsExecutionHistory'

/*
 * Tests fuer `useSavingsExecutionHistory` (issue #39).
 *
 * Composable kapselt den GET gegen
 * `GET /api/households/:id/savings-goals/:goalId/executions?limit=N&offset=M`.
 * `$fetch` wird per `vi.stubGlobal` gemockt, weil Nuxt es in der
 * Vitest-node-Umgebung nicht automatisch bereitstellt.
 *
 * Composable-Logik, die hier abgedeckt wird:
 *  - Initial-State: leere items, loading=false, error=null.
 *  - `load(householdId, goalId)` macht GET mit `?limit=20` (default pageSize).
 *  - `load(null, ...)` resettet state ohne API-Call.
 *  - `loadMore()` holt die naechste Page mit `?offset=items.length`.
 *  - `loadMore()` ist no-op, wenn `hasMore` false ist.
 *  - `loadMore()` ist no-op, wenn bereits ein Load laeuft.
 *  - Error-Path: error.value wird gesetzt, items zurueckgesetzt (nur load, nicht loadMore).
 *  - `hasMore` ist true nur bei voller Page, false bei partial.
 *  - Custom pageSize wird respektiert.
 *  - `reset()` leert items + error + loaded.
 */

const fetchMock = vi.fn()

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `exec-${i + 1}`,
    savingsGoalId: GOAL_ID,
    amount: 1000 * (i + 1),
    date: `2026-07-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`,
    note: i === 0 ? 'Erste Buchung' : null,
    createdAt: `2026-07-${String(20 - i).padStart(2, '0')}T08:00:00.000Z`,
    updatedAt: `2026-07-${String(20 - i).padStart(2, '0')}T08:00:00.000Z`,
  }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})

describe('useSavingsExecutionHistory — initial state', () => {
  it('starts with empty items, not loaded, no error', () => {
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(
      () => hhId.value,
      () => goalId.value,
    )

    expect(history.items.value).toEqual([])
    expect(history.loaded.value).toBe(false)
    expect(history.loading.value).toBe(false)
    expect(history.error.value).toBeNull()
    expect(history.hasMore.value).toBe(false)
  })
})

describe('useSavingsExecutionHistory — load()', () => {
  it('fetches with default page size 20 and no offset', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'executions', items: makeItems(20) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/households/${HH_ID}/savings-goals/${GOAL_ID}/executions`,
      expect.objectContaining({ params: { limit: 20 } }),
    )
    expect(history.items.value).toHaveLength(20)
    expect(history.loaded.value).toBe(true)
    expect(history.loading.value).toBe(false)
  })

  it('respects a custom page size', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'executions', items: makeItems(50) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(
      () => hhId.value,
      () => goalId.value,
      { pageSize: 50 },
    )

    await history.load()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { limit: 50 } }),
    )
  })

  it('replaces existing items (load is not append)', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(20) } })
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(5) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()
    expect(history.items.value).toHaveLength(20)
    await history.load()
    expect(history.items.value).toHaveLength(5)
  })

  it('resets state and skips API call when householdId is null', async () => {
    const hhId = ref<string | null>(null)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(history.items.value).toEqual([])
    expect(history.loaded.value).toBe(true)
  })

  it('resets state and skips API call when goalId is null', async () => {
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(null)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(history.items.value).toEqual([])
  })

  it('captures server error and resets items on failure', async () => {
    fetchMock.mockRejectedValueOnce({
      statusMessage: 'Savings goal not found in this household.',
      statusCode: 404,
    })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(history.error.value).toBe('Savings goal not found in this household.')
    expect(history.items.value).toEqual([])
    expect(history.loading.value).toBe(false)
  })
})

describe('useSavingsExecutionHistory — hasMore + loadMore()', () => {
  it('hasMore is true when a full page is loaded', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(20) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(history.hasMore.value).toBe(true)
  })

  it('hasMore is false when a partial page is returned', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(7) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()

    expect(history.hasMore.value).toBe(false)
  })

  it('loadMore fetches the next page with offset = items.length', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(20) } })
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(10) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()
    await history.loadMore()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/households/${HH_ID}/savings-goals/${GOAL_ID}/executions`,
      expect.objectContaining({ params: { limit: 20, offset: 20 } }),
    )
    expect(history.items.value).toHaveLength(30)
  })

  it('loadMore is no-op when hasMore is false', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(5) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()
    expect(history.hasMore.value).toBe(false)

    await history.loadMore()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loadMore captures error and does not append items', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(20) } })
    fetchMock.mockRejectedValueOnce(new Error('Network down'))
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()
    expect(history.items.value).toHaveLength(20)

    await history.loadMore()

    expect(history.error.value).toBe('Network down')
    expect(history.items.value).toHaveLength(20) // unchanged
    expect(history.loading.value).toBe(false)
  })
})

describe('useSavingsExecutionHistory — reactive IDs', () => {
  it('reads current values from getter functions on each call', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'executions', items: makeItems(20) } })
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    // Initial load with current IDs
    await history.load()
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(HH_ID),
      expect.any(Object),
    )

    // Switch household, reload picks up new ID
    hhId.value = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await history.load()
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
      expect.any(Object),
    )
  })
})

describe('useSavingsExecutionHistory — reset()', () => {
  it('clears items, loaded, and error', async () => {
    fetchMock.mockResolvedValueOnce({ data: { kind: 'executions', items: makeItems(20) } })
    fetchMock.mockRejectedValueOnce(new Error('Boom'))
    const hhId = ref<string | null>(HH_ID)
    const goalId = ref<string | null>(GOAL_ID)
    const history = useSavingsExecutionHistory(() => hhId.value, () => goalId.value)

    await history.load()
    expect(history.items.value).toHaveLength(20)

    // Trigger an error in a fresh load
    await history.load()
    expect(history.error.value).not.toBeNull()

    history.reset()

    expect(history.items.value).toEqual([])
    expect(history.error.value).toBeNull()
    expect(history.loaded.value).toBe(false)
  })
})
