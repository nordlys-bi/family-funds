import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useBookingDialog } from '../useBookingDialog'

/*
 * Tests fuer `useBookingDialog` (issue #38 — extrahiert aus savings.vue).
 *
 * Die Composable kapselt den kompletten Dialog-Lifecycle:
 *   - open/close + Reset der Form
 *   - Validierung (Betrag ungleich 0, Datum gesetzt, Goal gefunden)
 *   - Submit loest useSavingsExecutions.bookExecution aus
 *   - onSuccess wird nur bei Erfolg aufgerufen, close() automatisch
 *   - onError wird bei Validierungs- und API-Fehlern aufgerufen
 *
 * `$fetch` wird per `vi.stubGlobal` gemockt — gleicher Stil wie
 * useSavingsExecutions.test.ts, weil Nuxt $fetch in der Vitest-node-
 * Umgebung nicht automatisch bereitstellt.
 */

const fetchMock = vi.fn()
const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeExecutionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-new',
    savingsGoalId: GOAL_ID,
    amount: 5000,
    date: '2026-07-15T00:00:00.000Z',
    note: null,
    ...overrides,
  }
}

const sampleGoal = { id: GOAL_ID, name: 'Urlaub 2026' }

function makeComposable(overrides: {
  householdId?: string | null
  getGoal?: (id: string) => typeof sampleGoal | null
  onSuccess?: ReturnType<typeof vi.fn>
  onError?: ReturnType<typeof vi.fn>
} = {}) {
  const householdId = ref(overrides.householdId !== undefined ? overrides.householdId : HH_ID)
  const onSuccess = overrides.onSuccess ?? vi.fn()
  const onError = overrides.onError ?? vi.fn()
  const getGoal = overrides.getGoal ?? (() => sampleGoal)
  return {
    householdId,
    onSuccess,
    onError,
    ...useBookingDialog({
      householdId,
      getGoal,
      formatDate: (date) => {
        const yyyy = date.getFullYear()
        const mm = String(date.getMonth() + 1).padStart(2, '0')
        const dd = String(date.getDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}`
      },
      onSuccess,
      onError,
    }),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})

describe('useBookingDialog — open/close lifecycle', () => {
  it('starts with dialog closed and empty form', () => {
    const c = makeComposable()

    expect(c.dialogOpen.value).toBe(false)
    expect(c.goal.value).toBeNull()
    expect(c.form.value.amount).toBeNull()
    expect(c.form.value.date).toBeNull()
    expect(c.form.value.note).toBe('')
    expect(c.error.value).toBeNull()
  })

  it('open() sets goal, direction, fresh form, opens dialog', () => {
    const c = makeComposable()

    c.open(GOAL_ID, 'withdraw')

    expect(c.dialogOpen.value).toBe(true)
    expect(c.goal.value?.id).toBe(GOAL_ID)
    expect(c.direction.value).toBe('withdraw')
    expect(c.form.value.date).toBeInstanceOf(Date)
  })

  it('close() resets dialog, goal, and error', () => {
    const c = makeComposable()
    c.open(GOAL_ID, 'deposit')
    c.error.value = 'something'

    c.close()

    expect(c.dialogOpen.value).toBe(false)
    expect(c.goal.value).toBeNull()
    expect(c.error.value).toBeNull()
  })
})

describe('useBookingDialog — isValid', () => {
  it('is false when amount is null', () => {
    const c = makeComposable()
    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = null
    c.form.value.date = new Date('2026-07-15')

    expect(c.isValid.value).toBe(false)
  })

  it('is false when amount is 0', () => {
    const c = makeComposable()
    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 0
    c.form.value.date = new Date('2026-07-15')

    expect(c.isValid.value).toBe(false)
  })

  it('is false when date is null', () => {
    const c = makeComposable()
    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = null

    expect(c.isValid.value).toBe(false)
  })

  it('is true with valid amount and date', () => {
    const c = makeComposable()
    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date('2026-07-15')

    expect(c.isValid.value).toBe(true)
  })
})

describe('useBookingDialog — submit (success)', () => {
  it('calls bookExecution with formatted date and onSuccess on success', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow() } })
    const onSuccess = vi.fn()
    const c = makeComposable({ onSuccess })

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15) // 2026-07-15
    c.form.value.note = '  Urlaub Q3  '

    await c.submit()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/households/${HH_ID}/savings-goals/${GOAL_ID}/executions`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          amount: 50, // positive for deposit
          date: '2026-07-15',
          note: 'Urlaub Q3', // trimmed
        }),
      }),
    )
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'deposit',
        goalName: 'Urlaub 2026',
        goalId: GOAL_ID,
      }),
    )
    // Dialog schliesst automatisch nach Erfolg.
    expect(c.dialogOpen.value).toBe(false)
  })

  it('uses negative amount for withdraw direction', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow({ amount: -5000 }) } })
    const c = makeComposable()

    c.open(GOAL_ID, 'withdraw')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15)

    await c.submit()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ amount: -50 }),
      }),
    )
  })

  it('omits note when form.note is empty (undefined to server)', async () => {
    fetchMock.mockResolvedValue({ data: { kind: 'execution', item: makeExecutionRow() } })
    const c = makeComposable()

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15)
    c.form.value.note = '   ' // nur whitespace

    await c.submit()

    const callArgs = fetchMock.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(callArgs.body).toHaveProperty('note', undefined)
  })
})

describe('useBookingDialog — submit (validation failures)', () => {
  it('rejects without API call when householdId is null and calls onError', async () => {
    const onError = vi.fn()
    const c = makeComposable({ householdId: null, onError })

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15)

    await c.submit()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(c.error.value).toMatch(/Haushalt/)
    expect(onError).toHaveBeenCalledOnce()
    expect(c.dialogOpen.value).toBe(true) // bleibt offen
  })

  it('rejects without API call when amount is invalid and calls onError', async () => {
    const onError = vi.fn()
    const c = makeComposable({ onError })

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 0
    c.form.value.date = new Date(2026, 6, 15)

    await c.submit()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(c.error.value).toMatch(/Betrag/)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('rejects without API call when goal is not found and calls onError', async () => {
    const onError = vi.fn()
    const c = makeComposable({
      getGoal: () => null,
      onError,
    })

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15)

    await c.submit()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(c.error.value).toMatch(/nicht gefunden/)
    expect(onError).toHaveBeenCalledOnce()
  })
})

describe('useBookingDialog — submit (API failure)', () => {
  it('captures server error message, calls onError, keeps dialog open', async () => {
    fetchMock.mockRejectedValue({
      statusMessage: 'Execution not found in this goal/household.',
      statusCode: 404,
    })
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const c = makeComposable({ onError, onSuccess })

    c.open(GOAL_ID, 'deposit')
    c.form.value.amount = 50
    c.form.value.date = new Date(2026, 6, 15)

    await c.submit()

    expect(c.error.value).toBe('Execution not found in this goal/household.')
    expect(onError).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(c.dialogOpen.value).toBe(true)
    expect(c.posting.value).toBe(false)
  })
})
