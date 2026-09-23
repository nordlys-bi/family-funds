/*
 * Unit-Tests fuer `useListSwipe` (issue #132).
 *
 * Swipe auf den Planungs-Listen ist nur aktiv, wenn mobil UND Owner.
 * `useMediaQuery` wird durch einen steuerbaren Ref ersetzt, `useHousehold`
 * laeuft echt gegen einen `#app`-Stub (wie useHousehold.test.ts).
 *
 * Getestet: die vier Kombinationen aus mobil/Desktop x OWNER/MEMBER, der
 * Fall ohne aktiven Haushalt, und dass der Wert reaktiv nachzieht.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const stateStore = new Map<string, Ref<unknown>>()
const isMobile = ref(false)

vi.mock('#app', () => ({
  useState: <T>(key: string, initFn: () => T) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(initFn()) as Ref<unknown>)
    }
    return stateStore.get(key) as Ref<T>
  },
  useCookie: <T>() => ref<T | null>(null),
}))

vi.mock('../useMediaQuery', () => ({
  useMediaQuery: () => isMobile,
}))

const { useHousehold } = await import('../useHousehold')
const { useListSwipe, MOBILE_LIST_QUERY } = await import('../useListSwipe')

const owned = { id: 'h-owner', name: 'Meins', currency: 'EUR', role: 'OWNER' as const }
const shared = { id: 'h-member', name: 'Geteilt', currency: 'EUR', role: 'MEMBER' as const }

function activate(household: typeof owned | typeof shared) {
  const { households, setActiveHousehold } = useHousehold()
  households.value = [owned, shared]
  setActiveHousehold(household.id)
}

beforeEach(() => {
  stateStore.clear()
  isMobile.value = false
})

describe('useListSwipe — swipeDisabled', () => {
  it('ist aktiv (nicht disabled) mobil als OWNER', () => {
    isMobile.value = true
    activate(owned)
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(false)
  })

  it('ist disabled mobil als MEMBER (Bearbeiten/Loeschen sind Owner-only)', () => {
    isMobile.value = true
    activate(shared)
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(true)
  })

  it('ist disabled auf Desktop/Tablet (>= 640px), auch als OWNER', () => {
    isMobile.value = false
    activate(owned)
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(true)
  })

  it('ist disabled auf Desktop als MEMBER', () => {
    isMobile.value = false
    activate(shared)
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(true)
  })

  it('ist disabled ohne aktiven Haushalt', () => {
    isMobile.value = true
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(true)
  })

  it('zieht bei Breiten- und Haushaltswechsel reaktiv nach', () => {
    activate(owned)
    const { swipeDisabled } = useListSwipe()
    expect(swipeDisabled.value).toBe(true)

    isMobile.value = true
    expect(swipeDisabled.value).toBe(false)

    activate(shared)
    expect(swipeDisabled.value).toBe(true)

    activate(owned)
    isMobile.value = false
    expect(swipeDisabled.value).toBe(true)
  })
})

describe('useListSwipe — Mobil-Schwelle', () => {
  it('nutzt dieselbe Schwelle wie ItemCard/ListPanel (max-width: 639px)', () => {
    expect(MOBILE_LIST_QUERY).toBe('(max-width: 639px)')
  })
})
