/*
 * Unit-Tests fuer `useAskConfirm` (issue #51 — Promise-basierter
 * Confirm-Dialog).
 *
 * `useState` aus `#app` ist nicht im Vitest-Setup verfuegbar
 * (Vitest laeuft in node-Environment ohne Nuxt-Kontext). Wir mocken
 * es mit einem Map-basierten Stub, der dieselbe API hat:
 *   - get/set ueber .value
 *   - `useState('key', initFn)` gibt Ref zurueck
 *
 * Wichtige Verhaltensaspekte, die getestet werden:
 *   1. ask() setzt pending und gibt Promise zurueck
 *   2. confirm() loest Promise mit true
 *   3. cancel() loest Promise mit false
 *   4. confirm()/cancel() sind idempotent ohne pending
 *   5. Re-ask() waehrend pending loest alten Promise mit false
 *   6. Pending-Value wird nach confirm/cancel auf null gesetzt
 *
 * Mocking-Pattern: `vi.mock('#app', ...)` mit Factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

// Mock-Speicher: Map<key, Ref<any>>
const stateStore = new Map<string, Ref<unknown>>()

vi.mock('#app', () => ({
  useState: <T>(key: string, initFn: () => T) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(initFn()) as Ref<unknown>)
    }
    return stateStore.get(key) as Ref<T>
  },
}))

// useAskConfirm muss NACH dem mock importiert werden, damit der
// vi.mock-Hook greift.
const { useAskConfirm } = await import('../useAskConfirm')

beforeEach(() => {
  // Jeder Test startet mit leerem pending-State
  stateStore.clear()
})

afterEach(() => {
  stateStore.clear()
})

describe('useAskConfirm — ask()', () => {
  it('setzt pending-Value mit dem uebergebenen Request', () => {
    const { pending, ask } = useAskConfirm()
    expect(pending.value).toBeNull()

    void ask({
      title: 'Wirklich?',
      message: 'Bitte bestaetigen.',
      tone: 'danger',
    })

    expect(pending.value).not.toBeNull()
    expect(pending.value?.request.title).toBe('Wirklich?')
    expect(pending.value?.request.message).toBe('Bitte bestaetigen.')
    expect(pending.value?.request.tone).toBe('danger')
  })

  it('gibt einen Promise zurueck, der mit true resolved bei confirm()', async () => {
    const { ask, confirm } = useAskConfirm()
    const promise = ask({ title: 't', message: 'm', tone: 'primary' })
    confirm()
    await expect(promise).resolves.toBe(true)
  })

  it('gibt einen Promise zurueck, der mit false resolved bei cancel()', async () => {
    const { ask, cancel } = useAskConfirm()
    const promise = ask({ title: 't', message: 'm', tone: 'danger' })
    cancel()
    await expect(promise).resolves.toBe(false)
  })

  it('setzt pending auf null nach confirm()', async () => {
    const { pending, ask, confirm } = useAskConfirm()
    const promise = ask({ title: 't', message: 'm', tone: 'primary' })
    expect(pending.value).not.toBeNull()
    confirm()
    await promise
    expect(pending.value).toBeNull()
  })

  it('setzt pending auf null nach cancel()', async () => {
    const { pending, ask, cancel } = useAskConfirm()
    const promise = ask({ title: 't', message: 'm', tone: 'danger' })
    cancel()
    await promise
    expect(pending.value).toBeNull()
  })

  it('optionale Labels werden im Request gespeichert', () => {
    const { pending, ask } = useAskConfirm()
    void ask({
      title: 't',
      message: 'm',
      tone: 'primary',
      confirmLabel: 'Ja, los',
      cancelLabel: 'Nee',
    })
    expect(pending.value?.request.confirmLabel).toBe('Ja, los')
    expect(pending.value?.request.cancelLabel).toBe('Nee')
  })
})

describe('useAskConfirm — idempotente confirm()/cancel()', () => {
  it('confirm() ohne pending ist ein no-op (wirft nicht)', () => {
    const { confirm } = useAskConfirm()
    expect(() => confirm()).not.toThrow()
  })

  it('cancel() ohne pending ist ein no-op (wirft nicht)', () => {
    const { cancel } = useAskConfirm()
    expect(() => cancel()).not.toThrow()
  })

  it('confirm() nach bereits aufgeloestem Promise ist idempotent', async () => {
    const { ask, confirm } = useAskConfirm()
    const promise = ask({ title: 't', message: 'm', tone: 'primary' })
    confirm()
    await promise
    // Zweites confirm() darf nicht werfen
    expect(() => confirm()).not.toThrow()
  })
})

describe('useAskConfirm — Re-ask waerend pending', () => {
  it('loest den alten Promise mit false auf, wenn ein neuer ask() kommt', async () => {
    const { ask, cancel } = useAskConfirm()
    const firstPromise = ask({ title: '1', message: '1', tone: 'primary' })

    // Neuer ask(), bevor der erste aufgeloest wurde
    const secondPromise = ask({ title: '2', message: '2', tone: 'danger' })

    // Erster Promise muss false gesehen haben (cancel-Verhalten)
    await expect(firstPromise).resolves.toBe(false)
    // Zweiter Promise haengt noch
    expect(pendingState()).not.toBeNull()
    expect(pendingState()?.request.title).toBe('2')

    // Aufloesen des zweiten
    cancel()
    await expect(secondPromise).resolves.toBe(false)
  })

  it('nur EIN pending-Dialog kann gleichzeitig offen sein (useState shared)', () => {
    const instance1 = useAskConfirm()
    const instance2 = useAskConfirm()

    void instance1.ask({ title: '1', message: '1', tone: 'primary' })
    // Gleicher useState-Key, gleicher Ref
    expect(instance2.pending.value).not.toBeNull()
    expect(instance2.pending.value?.request.title).toBe('1')
  })
})

// Helper weil der pending-State innerhalb der Composable-Closure lebt
function pendingState() {
  return useAskConfirm().pending.value
}
