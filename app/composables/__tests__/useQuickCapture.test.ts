/*
 * Unit-Tests fuer `useQuickCapture` (issue #91 — globaler Erfassen-Dialog).
 *
 * Wie useAskConfirm.test.ts mocken wir `useState` aus `#app` mit einem
 * Map-basierten Stub (Vitest laeuft ohne Nuxt-Kontext).
 *
 * Getestet:
 *   1. Default-State: geschlossen, kind = 'expense'
 *   2. open() setzt open=true, default kind 'expense'
 *   3. open('income') setzt kind explizit
 *   4. close() setzt open=false, kind bleibt erhalten
 *   5. setKind() wechselt kind, ohne open zu beruehren
 *   6. markSaved() erhoeht savedTick monoton
 *   7. State ist geteilt (useState) zwischen Instanzen
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const stateStore = new Map<string, Ref<unknown>>()

vi.mock('#app', () => ({
  useState: <T>(key: string, initFn: () => T) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(initFn()) as Ref<unknown>)
    }
    return stateStore.get(key) as Ref<T>
  },
}))

const { useQuickCapture } = await import('../useQuickCapture')

beforeEach(() => {
  stateStore.clear()
})

afterEach(() => {
  stateStore.clear()
})

describe('useQuickCapture — Default-State', () => {
  it('startet geschlossen mit kind = expense', () => {
    const qc = useQuickCapture()
    expect(qc.isOpen.value).toBe(false)
    expect(qc.kind.value).toBe('expense')
    expect(qc.savedTick.value).toBe(0)
  })
})

describe('useQuickCapture — open()', () => {
  it('open() ohne Argument oeffnet mit kind = expense', () => {
    const qc = useQuickCapture()
    qc.open()
    expect(qc.isOpen.value).toBe(true)
    expect(qc.kind.value).toBe('expense')
  })

  it('open("income") oeffnet mit kind = income', () => {
    const qc = useQuickCapture()
    qc.open('income')
    expect(qc.isOpen.value).toBe(true)
    expect(qc.kind.value).toBe('income')
  })
})

describe('useQuickCapture — close()', () => {
  it('close() setzt open auf false, kind bleibt erhalten', () => {
    const qc = useQuickCapture()
    qc.open('income')
    qc.close()
    expect(qc.isOpen.value).toBe(false)
    expect(qc.kind.value).toBe('income')
  })
})

describe('useQuickCapture — setKind()', () => {
  it('wechselt kind, ohne open zu veraendern', () => {
    const qc = useQuickCapture()
    qc.open('expense')
    qc.setKind('income')
    expect(qc.isOpen.value).toBe(true)
    expect(qc.kind.value).toBe('income')

    qc.close()
    qc.setKind('expense')
    expect(qc.isOpen.value).toBe(false)
    expect(qc.kind.value).toBe('expense')
  })
})

describe('useQuickCapture — markSaved()', () => {
  it('erhoeht savedTick monoton', () => {
    const qc = useQuickCapture()
    expect(qc.savedTick.value).toBe(0)
    qc.markSaved()
    expect(qc.savedTick.value).toBe(1)
    qc.markSaved()
    expect(qc.savedTick.value).toBe(2)
  })
})

describe('useQuickCapture — geteilter State', () => {
  it('zwei Instanzen teilen denselben State (useState)', () => {
    const a = useQuickCapture()
    const b = useQuickCapture()
    a.open('income')
    expect(b.isOpen.value).toBe(true)
    expect(b.kind.value).toBe('income')
    b.markSaved()
    expect(a.savedTick.value).toBe(1)
  })
})
