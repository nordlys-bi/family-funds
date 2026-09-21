/*
 * Unit-Tests fuer `useHousehold().canManageHousehold` (issue #128).
 *
 * `canManageHousehold` ist die zentrale Owner-Pruefung der UI und spiegelt
 * die serverseitigen `requireHouseholdOwner`-Endpoints. Wie useQuickCapture.test.ts
 * mocken wir `useState`/`useCookie` aus `#app` (Vitest laeuft ohne Nuxt-Kontext).
 *
 * Getestet:
 *   1. Ohne aktiven Haushalt: false
 *   2. OWNER: true
 *   3. MEMBER: false
 *   4. Reagiert auf den Wechsel des aktiven Haushalts (OWNER <-> MEMBER)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const stateStore = new Map<string, Ref<unknown>>()

vi.mock('#app', () => ({
  useState: <T>(key: string, initFn: () => T) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(initFn()) as Ref<unknown>)
    }
    return stateStore.get(key) as Ref<T>
  },
  useCookie: <T>() => ref<T | null>(null),
}))

const { useHousehold } = await import('../useHousehold')

const owned = { id: 'h-owner', name: 'Meins', currency: 'EUR', role: 'OWNER' as const }
const shared = { id: 'h-member', name: 'Geteilt', currency: 'EUR', role: 'MEMBER' as const }

beforeEach(() => {
  stateStore.clear()
})

describe('useHousehold — canManageHousehold', () => {
  it('ist false, solange kein Haushalt aktiv ist', () => {
    const { canManageHousehold } = useHousehold()
    expect(canManageHousehold.value).toBe(false)
  })

  it('ist true fuer die Rolle OWNER', () => {
    const { households, setActiveHousehold, canManageHousehold } = useHousehold()
    households.value = [owned]
    setActiveHousehold(owned.id)
    expect(canManageHousehold.value).toBe(true)
  })

  it('ist false fuer die Rolle MEMBER', () => {
    const { households, setActiveHousehold, canManageHousehold } = useHousehold()
    households.value = [shared]
    setActiveHousehold(shared.id)
    expect(canManageHousehold.value).toBe(false)
  })

  it('folgt dem Wechsel des aktiven Haushalts', () => {
    const { households, setActiveHousehold, canManageHousehold } = useHousehold()
    households.value = [owned, shared]

    setActiveHousehold(owned.id)
    expect(canManageHousehold.value).toBe(true)

    setActiveHousehold(shared.id)
    expect(canManageHousehold.value).toBe(false)

    setActiveHousehold(owned.id)
    expect(canManageHousehold.value).toBe(true)
  })
})
