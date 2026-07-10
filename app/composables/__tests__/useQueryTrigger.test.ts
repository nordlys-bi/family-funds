import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'
import { useQueryTrigger } from '../useQueryTrigger'

/**
 * Tests fuer `useQueryTrigger` (issue #29 — FAB Quick-Add).
 *
 * Die Composable nutzt `useRoute()` / `useRouter()` aus Nuxt. In Vitest
 * ohne Nuxt-Kontext muessen route/router ueber die Options injiziert
 * werden — exakt der gleiche Pfad, den die Pages im Production-Code
 * einschlagen wuerden.
 *
 * Was hier abgedeckt wird:
 *  - Trigger feuert beim ersten Mount mit passendem Query-Wert
 *  - URL wird danach via `router.replace({ query })` aufgeraeumt
 *  - Andere Query-Keys (z. B. ?month=YYYY-MM) bleiben unberuehrt
 *  - Re-Render mit gleichem Query feuert NICHT erneut (Doppel-Oeffnen-Schutz)
 *  - Falscher / fehlender Query feuert NICHT
 *  - Falscher Wert (z. B. "0" statt "1") feuert NICHT
 */

function makeHarness(initialQuery: Record<string, unknown> = {}) {
  const route = reactive({ query: { ...initialQuery } })
  const router = { replace: vi.fn() }
  const onTrigger = vi.fn()
  return { route, router, onTrigger }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useQueryTrigger — initial mount', () => {
  it('fires the trigger when the query matches on mount', () => {
    const { route, router, onTrigger } = makeHarness({ new: '1' })
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledTimes(1)
  })

  it('clears only the trigger key, preserves other query params', () => {
    const { route, router, onTrigger } = makeHarness({ new: '1', month: '2026-07' })
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(router.replace).toHaveBeenCalledWith({ query: { month: '2026-07' } })
  })

  it('does not fire when the query is missing', () => {
    const { route, router, onTrigger } = makeHarness({})
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(onTrigger).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does not fire when the query value is wrong (e.g. "0" instead of "1")', () => {
    const { route, router, onTrigger } = makeHarness({ new: '0' })
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(onTrigger).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('respects a custom expectedValue', () => {
    const { route, router, onTrigger } = makeHarness({ open: 'yes' })
    useQueryTrigger({ queryKey: 'open', expectedValue: 'yes', onTrigger, route, router })
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ query: {} })
  })
})

describe('useQueryTrigger — re-render protection', () => {
  it('does not fire again when the same query is re-set during the page lifetime', async () => {
    const { route, router, onTrigger } = makeHarness({ new: '1' })
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(onTrigger).toHaveBeenCalledTimes(1)

    // Simuliere Re-Render: Query wird auf "0" gesetzt und wieder auf "1".
    // Ohne den consumed-Guard wuerde der Trigger ein zweites Mal feuern.
    route.query.new = '0'
    await nextTick()
    route.query.new = '1'
    await nextTick()

    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledTimes(1)
  })

  it('does not re-fire when an external nav re-adds the trigger key (back/forward)', async () => {
    // Szenario: Page mounted mit ?new=1, Trigger feuert, URL wird geputzt.
    // User klickt im Browser "Back" und landet wieder auf der deep-link-URL.
    // Trigger darf NICHT erneut feuern, sonst oeffnet sich der Dialog doppelt.
    const { route, router, onTrigger } = makeHarness({ new: '1' })
    useQueryTrigger({ queryKey: 'new', onTrigger, route, router })
    expect(onTrigger).toHaveBeenCalledTimes(1)

    // Browser-Back stellt den geloeschten Query wieder her.
    route.query = { new: '1' }
    await nextTick()

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })
})
