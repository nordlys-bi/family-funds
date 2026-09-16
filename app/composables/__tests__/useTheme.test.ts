/*
 * Unit-Tests fuer `useTheme` (Issue "Theme: OS-Farbschema als Default,
 * manuell umstellbar").
 *
 * Wie useAskConfirm.test.ts / useQuickCapture.test.ts mocken wir `useState`
 * aus `#app` mit einem Map-basierten Stub (Vitest laeuft ohne Nuxt-Kontext).
 *
 * `initClient()`/`disposeClient()` sind hinter `import.meta.client` gated,
 * das unter Plain-Vitest (kein Nuxt-/Vite-Build-Replace) falsy ist — wie bei
 * useReducedMotion.test.ts testen wir deshalb nur den davon unabhaengigen
 * Teil (die reine Ableitungs-Logik + `setPreference`, das den Ref *vor* dem
 * Client-Guard setzt). Das eigentliche localStorage-/matchMedia-Verhalten
 * wurde manuell im Browser verifiziert (Toggle + Reload + Live-OS-Wechsel).
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

const { useTheme } = await import('../useTheme')

beforeEach(() => {
  stateStore.clear()
})

afterEach(() => {
  stateStore.clear()
})

describe('useTheme — Ableitungslogik', () => {
  it('default: preference "system" + OS dunkel ergibt effective "dark"', () => {
    const { preference, effective, htmlClass, htmlDataTheme } = useTheme()
    expect(preference.value).toBe('system')
    expect(effective.value).toBe('dark')
    expect(htmlClass.value).toBe('my-app my-app-dark')
    expect(htmlDataTheme.value).toBeUndefined()
  })

  it('preference "system" + OS hell ergibt effective "light"', () => {
    useTheme()
    // Simuliert das, was initClient() nach einem matchMedia-Read setzen wuerde.
    const systemPrefersLight = stateStore.get('theme-system-prefers-light') as Ref<boolean>
    systemPrefersLight.value = true

    const { effective, htmlClass, htmlDataTheme } = useTheme()
    expect(effective.value).toBe('light')
    expect(htmlClass.value).toBe('my-app')
    expect(htmlDataTheme.value).toBe('light')
  })

  it('preference "light" gewinnt unabhaengig von der OS-Praeferenz', () => {
    const { setPreference, effective, htmlClass, htmlDataTheme } = useTheme()
    setPreference('light')
    expect(effective.value).toBe('light')
    expect(htmlClass.value).toBe('my-app')
    expect(htmlDataTheme.value).toBe('light')

    const systemPrefersLight = stateStore.get('theme-system-prefers-light') as Ref<boolean>
    systemPrefersLight.value = false
    expect(effective.value).toBe('light')
  })

  it('preference "dark" gewinnt unabhaengig von der OS-Praeferenz', () => {
    const systemPrefersLight = ref(true)
    stateStore.set('theme-system-prefers-light', systemPrefersLight as Ref<unknown>)

    const { setPreference, effective, htmlClass, htmlDataTheme } = useTheme()
    setPreference('dark')
    expect(effective.value).toBe('dark')
    expect(htmlClass.value).toBe('my-app my-app-dark')
    expect(htmlDataTheme.value).toBeUndefined()
  })
})

describe('useTheme — geteilter State (useState-Singleton)', () => {
  it('setPreference() aus einer Instanz ist in einer anderen sichtbar', () => {
    const first = useTheme()
    const second = useTheme()

    first.setPreference('dark')
    expect(second.preference.value).toBe('dark')
    expect(second.effective.value).toBe('dark')
  })
})

describe('useTheme — Client-Guards (SSR-sicher)', () => {
  it('initClient() und disposeClient() werfen nicht ausserhalb eines Client-Kontexts', () => {
    const { initClient, disposeClient } = useTheme()
    expect(() => initClient()).not.toThrow()
    expect(() => disposeClient()).not.toThrow()
  })
})
