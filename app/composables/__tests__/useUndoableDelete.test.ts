import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useUndoableDelete } from '../useUndoableDelete'

/*
 * Tests fuer `useUndoableDelete` (issue #58 — Soft-Delete mit Undo).
 *
 * Die Composable kapselt:
 *   - deleteWithUndo: optimistic remove + DELETE-Call + Toast + 5s-Timer
 *   - undo: POST /restore + restore in lokaler Liste
 *   - dismiss: nur Timer abräumen, kein Server-Call (Variante A)
 *   - Rollback bei Server-Fehler in deleteWithUndo und undo
 *
 * `$fetch` und `useToast` werden per vi.stubGlobal / vi.mock ersetzt.
 * `onBeforeUnmount` aus Vue ist in Vitest ohne mount no-op — wir testen
 * die Cleanup-Pfade ueber explizite Aufrufe statt.
 */

const fetchMock = vi.fn()
const toastMock = {
  add: vi.fn(),
  removeGroup: vi.fn(),
}

vi.mock('primevue/usetoast', () => ({
  useToast: () => toastMock,
}))

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const EXPENSE_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const INCOME_ID = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e'

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE_ID,
    description: 'Rewe Einkauf',
    amount: 4250,
    ...overrides,
  }
}

type HarnessOptions = {
  householdId?: string | null
  kind?: 'expense' | 'income'
  onRemoveLocal?: ReturnType<typeof vi.fn>
  onRestoreLocal?: ReturnType<typeof vi.fn>
  onAfterChange?: ReturnType<typeof vi.fn>
  undoWindowMs?: number
}

function makeHarness(opts: HarnessOptions = {}) {
  const householdId = ref(opts.householdId !== undefined ? opts.householdId : HH_ID)
  const onRemoveLocal = opts.onRemoveLocal ?? vi.fn()
  const onRestoreLocal = opts.onRestoreLocal ?? vi.fn()
  const onAfterChange = opts.onAfterChange ?? vi.fn()
  const kind = opts.kind ?? 'expense'

  const harness = useUndoableDelete({
    householdId: () => householdId.value,
    kind,
    onRemoveLocal,
    onRestoreLocal,
    onAfterChange,
    undoWindowMs: opts.undoWindowMs,
  })

  return { householdId, onRemoveLocal, onRestoreLocal, onAfterChange, ...harness }
}

beforeEach(() => {
  fetchMock.mockReset()
  toastMock.add.mockReset()
  toastMock.removeGroup.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// === deleteWithUndo ======================================================
describe('useUndoableDelete — deleteWithUndo', () => {
  it('calls DELETE on the right URL and removes the item locally', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'expense', deleted: true } })
    const h = makeHarness()
    const item = makeItem()

    await h.deleteWithUndo(item)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/households/${HH_ID}/expenses/${EXPENSE_ID}`,
      { method: 'DELETE' },
    )
    expect(h.onRemoveLocal).toHaveBeenCalledWith(EXPENSE_ID)
    expect(h.pending.value.size).toBe(1)
  })

  it('uses the income URL path when kind is "income"', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'income', deleted: true } })
    const h = makeHarness({ kind: 'income' })
    const item = { id: INCOME_ID, description: 'Gehalt' }

    await h.deleteWithUndo(item)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/households/${HH_ID}/incomes/${INCOME_ID}`,
      { method: 'DELETE' },
    )
  })

  it('rolls back the local remove when the DELETE call fails', async () => {
    fetchMock.mockRejectedValue(new Error('Network down'))
    const h = makeHarness()
    const item = makeItem()

    await h.deleteWithUndo(item)

    expect(h.onRemoveLocal).toHaveBeenCalledWith(EXPENSE_ID) // optimistic
    expect(h.onRestoreLocal).toHaveBeenCalledWith(item) // rollback
    expect(h.pending.value.size).toBe(0) // no undo banner
    expect(toastMock.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    )
  })

  it('does nothing if householdId is null', async () => {
    const h = makeHarness({ householdId: null })
    await h.deleteWithUndo(makeItem())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.onRemoveLocal).not.toHaveBeenCalled()
  })

  it('shows a success/info toast with the undo group tag', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'expense', deleted: true } })
    const h = makeHarness()
    await h.deleteWithUndo(makeItem())

    expect(toastMock.add).toHaveBeenCalledWith(
      expect.objectContaining({
        group: `undo-${EXPENSE_ID}`,
      }),
    )
  })
})

// === undo =================================================================
describe('useUndoableDelete — undo', () => {
  it('calls POST on the restore URL and inserts the item back locally', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { kind: 'expense', deleted: true } }) // delete
      .mockResolvedValueOnce({ data: { kind: 'expense', restored: true } }) // restore
    const h = makeHarness()
    const item = makeItem()

    await h.deleteWithUndo(item)
    expect(h.pending.value.has(EXPENSE_ID)).toBe(true)

    await h.undo(EXPENSE_ID)

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/households/${HH_ID}/expenses/${EXPENSE_ID}/restore`,
      { method: 'POST' },
    )
    expect(h.onRestoreLocal).toHaveBeenCalledWith(item)
    expect(h.onAfterChange).toHaveBeenCalled()
    expect(h.pending.value.has(EXPENSE_ID)).toBe(false)
  })

  it('is a no-op if the id is not in pending state', async () => {
    const h = makeHarness()
    await h.undo('unknown-id')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.onRestoreLocal).not.toHaveBeenCalled()
  })

  it('clears the timer and shows an error toast when the restore call fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { kind: 'expense', deleted: true } })
      .mockRejectedValueOnce(new Error('Server kaputt'))
    const h = makeHarness()
    await h.deleteWithUndo(makeItem())

    await h.undo(EXPENSE_ID)

    // Restore-Fehler heisst nicht, dass das Item in der Liste ist (es wurde
    // bereits serverseitig deleted). onRestoreLocal wird NICHT aufgerufen.
    expect(h.onRestoreLocal).not.toHaveBeenCalled()
    expect(toastMock.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: 'error' }),
    )
  })

  it('removes the undo toast group after a successful restore', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { kind: 'expense', deleted: true } })
      .mockResolvedValueOnce({ data: { kind: 'expense', restored: true } })
    const h = makeHarness()
    await h.deleteWithUndo(makeItem())
    await h.undo(EXPENSE_ID)

    expect(toastMock.removeGroup).toHaveBeenCalledWith(`undo-${EXPENSE_ID}`)
  })
})

// === Timer / Auto-Hide ====================================================
describe('useUndoableDelete — timer behavior', () => {
  it('removes the pending entry after the undo window expires (no server call)', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'expense', deleted: true } })
    const h = makeHarness({ undoWindowMs: 1000 })
    await h.deleteWithUndo(makeItem())
    expect(h.pending.value.size).toBe(1)

    vi.advanceTimersByTime(1000)

    expect(h.pending.value.size).toBe(0)
    // Kein weiterer Server-Call: Variante A (soft-permanent), der Eintrag
    // bleibt mit deletedAt in der DB.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not remove the entry if the window has not yet elapsed', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'expense', deleted: true } })
    const h = makeHarness({ undoWindowMs: 5000 })
    await h.deleteWithUndo(makeItem())
    vi.advanceTimersByTime(4999)
    expect(h.pending.value.size).toBe(1)
  })
})

// === dismiss =============================================================
describe('useUndoableDelete — dismiss', () => {
  it('removes the pending entry without server call (user clicked X on banner)', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'expense', deleted: true } })
    const h = makeHarness()
    await h.deleteWithUndo(makeItem())
    h.dismiss(EXPENSE_ID)
    expect(h.pending.value.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1) // nur der DELETE, kein Restore
  })
})
