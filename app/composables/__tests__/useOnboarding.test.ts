/*
 * Unit-Tests fuer `useOnboarding` (issue #16).
 *
 * Testet:
 *  - load() holt State vom Server
 *  - shouldAutoTrigger entscheidet anhand von skip/completed/activity
 *  - markComplete fuegt Step idempotent hinzu
 *  - skipTour setzt skipped=true und schliesst Modal
 *  - restartTour resettet State
 *  - progress rechnet korrekt
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboarding } from '../useOnboarding'

// $fetch global mocken. Das ist Nuxt-Injected; im Vitest-Setup nicht
// verfuegbar, also shimmen wir es.
declare global {
  // eslint-disable-next-line no-var
  var $fetch: any
}

let fetchMock: any

beforeEach(() => {
  fetchMock = vi.fn()
  ;(globalThis as any).$fetch = fetchMock
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(response: any) {
  fetchMock.mockResolvedValueOnce({ data: response })
}

describe('useOnboarding — load()', () => {
  it('initialisiert completedSteps + skipped vom Server', async () => {
    mockFetchOnce({ completedSteps: ['household'], skipped: false })
    const ob = useOnboarding()

    await ob.load()

    expect(ob.completedSteps.value).toEqual(['household'])
    expect(ob.skipped.value).toBe(false)
    expect(ob.error.value).toBeNull()
  })

  it('faellt bei Server-Fehler auf leeren State zurueck', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network down'))
    const ob = useOnboarding()

    await ob.load()

    expect(ob.completedSteps.value).toEqual([])
    expect(ob.skipped.value).toBe(false)
    expect(ob.error.value).toContain('Network down')
  })
})

describe('useOnboarding — shouldAutoTrigger', () => {
  it('true wenn nie geskippt + nicht alle Steps done + leerer Haushalt', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()

    expect(ob.shouldAutoTrigger(null)).toBe(true)
    expect(ob.shouldAutoTrigger({ memberCount: 0, budgetCount: 0, transactionCount: 0 })).toBe(true)
  })

  it('true wenn nur Members, keine Budgets/Transaktionen', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()

    expect(ob.shouldAutoTrigger({ memberCount: 2, budgetCount: 0, transactionCount: 0 })).toBe(true)
  })

  it('false wenn alle Steps done', async () => {
    mockFetchOnce({
      completedSteps: ['household', 'invite', 'budget', 'transaction'],
      skipped: false,
    })
    const ob = useOnboarding()
    await ob.load()

    expect(ob.shouldAutoTrigger(null)).toBe(false)
    expect(ob.shouldAutoTrigger({ memberCount: 0, budgetCount: 0, transactionCount: 0 })).toBe(false)
  })

  it('false wenn User explizit geskippt hat', async () => {
    mockFetchOnce({ completedSteps: [], skipped: true })
    const ob = useOnboarding()
    await ob.load()

    expect(ob.shouldAutoTrigger(null)).toBe(false)
  })

  it('false wenn Haushalt aktiv befuellt ist (1+ Member, 1+ Budget, 1+ Tx)', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()

    expect(ob.shouldAutoTrigger({ memberCount: 2, budgetCount: 1, transactionCount: 5 })).toBe(false)
  })
})

describe('useOnboarding — markComplete', () => {
  it('fuegt einen neuen Step hinzu und persistiert', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    mockFetchOnce({}) // PATCH response
    const ob = useOnboarding()
    await ob.load()

    await ob.markComplete('household')

    expect(ob.completedSteps.value).toContain('household')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/onboarding',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ completedSteps: ['household'] }),
      }),
    )
  })

  it('ist idempotent: zweiter Call fuer gleichen Step ist no-op', async () => {
    mockFetchOnce({ completedSteps: ['household'], skipped: false })
    const ob = useOnboarding()
    await ob.load()
    fetchMock.mockClear()

    await ob.markComplete('household')

    expect(ob.completedSteps.value).toEqual(['household'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('schliesst das Modal wenn alle 4 Steps done sind', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    mockFetchOnce({})
    const ob = useOnboarding()
    await ob.load()

    ob.start()
    await ob.markComplete('household')
    expect(ob.isActive.value).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: {} })
    await ob.markComplete('invite')
    fetchMock.mockResolvedValueOnce({ data: {} })
    await ob.markComplete('budget')
    fetchMock.mockResolvedValueOnce({ data: {} })
    await ob.markComplete('transaction')

    expect(ob.completedSteps.value).toHaveLength(4)
    expect(ob.isActive.value).toBe(false)
    expect(ob.isComplete.value).toBe(true)
  })
})

describe('useOnboarding — skipTour + restartTour', () => {
  it('skipTour setzt skipped=true und schliesst Modal', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    mockFetchOnce({})
    const ob = useOnboarding()
    await ob.load()
    ob.start()

    await ob.skipTour()

    expect(ob.skipped.value).toBe(true)
    expect(ob.isActive.value).toBe(false)
  })

  it('restartTour resettet completedSteps + skipped und oeffnet Modal', async () => {
    mockFetchOnce({ completedSteps: ['household'], skipped: true })
    mockFetchOnce({})
    const ob = useOnboarding()
    await ob.load()

    await ob.restartTour()

    expect(ob.completedSteps.value).toEqual([])
    expect(ob.skipped.value).toBe(false)
    expect(ob.isActive.value).toBe(true)
  })
})

describe('useOnboarding — progress', () => {
  it('0% bei leerem State', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()
    expect(ob.progress.value).toBe(0)
  })

  it('25% nach 1/4 Steps', async () => {
    mockFetchOnce({ completedSteps: ['household'], skipped: false })
    const ob = useOnboarding()
    await ob.load()
    expect(ob.progress.value).toBe(25)
  })

  it('100% bei allen Steps done', async () => {
    mockFetchOnce({
      completedSteps: ['household', 'invite', 'budget', 'transaction'],
      skipped: false,
    })
    const ob = useOnboarding()
    await ob.load()
    expect(ob.progress.value).toBe(100)
    expect(ob.isComplete.value).toBe(true)
  })
})

describe('useOnboarding — start()/close()', () => {
  it('start() oeffnet das Modal', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()

    ob.start()
    expect(ob.isActive.value).toBe(true)
  })

  it('start() macht nichts wenn alle Steps schon done sind', async () => {
    mockFetchOnce({
      completedSteps: ['household', 'invite', 'budget', 'transaction'],
      skipped: false,
    })
    const ob = useOnboarding()
    await ob.load()

    ob.start()
    expect(ob.isActive.value).toBe(false)
  })

  it('close() schliesst ohne Skip', async () => {
    mockFetchOnce({ completedSteps: [], skipped: false })
    const ob = useOnboarding()
    await ob.load()
    ob.start()

    ob.close()
    expect(ob.isActive.value).toBe(false)
    expect(ob.skipped.value).toBe(false)
  })
})