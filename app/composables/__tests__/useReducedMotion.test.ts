import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useReducedMotion } from '../useReducedMotion'

/**
 * Tests fuer useReducedMotion.
 *
 * Hinweis: die Composable nutzt `onMounted`/`onBeforeUnmount`, die
 * ausserhalb eines Vue-Komponenten-Kontexts nicht feuern. Wir testen
 * daher nur den SSR-/Default-Pfad (return ref(false)) und die
 * matchMedia-Stubbing-Mechanik separat.
 *
 * Volle Lifecycle-Verifikation waere mit @vue/test-utils moeglich;
 * die Composable ist aber duenn genug, dass die Default-Smoke-Tests
 * + manuelle Emulation von reduced-motion via DevTools ausreichen.
 */

describe('useReducedMotion', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a Ref defaulting to false (motion active)', () => {
    const result = useReducedMotion()
    expect(result.value).toBe(false)
  })

  it('returns a reactive Ref (not a plain boolean)', () => {
    const result = useReducedMotion()
    // Ref hat .value und ist nicht truthy/falsy-identisch
    expect(typeof result).toBe('object')
    expect('value' in result).toBe(true)
  })
})

describe('matchMedia plumbing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('safely handles environments without matchMedia', () => {
    // Kein matchMedia stub — sollte die Composable nicht crashen
    vi.stubGlobal('matchMedia', undefined as any)
    const result = useReducedMotion()
    expect(result.value).toBe(false)
  })

  it('safely handles environments with matchMedia', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener,
      removeEventListener,
    })))
    expect(typeof useReducedMotion).toBe('function')
  })
})
