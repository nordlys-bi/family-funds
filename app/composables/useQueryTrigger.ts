/*
 * useQueryTrigger — feuert einen Trigger (z. B. openCreateTransactionDialog)
 * genau einmal, wenn ein Query-Param in der URL gesetzt ist, und raeumt
 * den Query-Param danach auf. Wird der Trigger NICHT erneut gefeuert,
 * falls der Query waehrend der Page-Lifetime erneut gesetzt wird (z. B.
 * durch Re-Render oder Back/Forward) — verhindert doppeltes Oeffnen.
 *
 * Pattern fuer issue #29 (FAB Quick-Add):
 *   - FAB navigiert nach /transactions/expenses?new=1
 *   - Die Page reagiert darauf mit openCreateTransactionDialog() und
 *     putzt die URL auf /transactions/expenses (kein Query-Smear beim Reload).
 *   - Deep-Link auf /transactions/expenses?new=1 funktioniert identisch.
 *
 * Wiederbenutzbar: income.vue nutzt denselben Hook mit gleichem queryKey.
 *
 * SSR-Verhalten: der Watch wird auf dem Server uebersprungen (kein DOM,
 * Teleport-Ziel fehlt). Auf dem Client feuert `immediate: true` den
 * Trigger beim ersten Setup-Tick nach Hydration.
 */
import { ref, watch } from 'vue'

export type QueryRouteLike = {
  query: Record<string, unknown>
}

export type QueryRouterLike = {
  replace: (to: { query: Record<string, unknown> }) => unknown
}

export type UseQueryTriggerOptions = {
  /** Name des Query-Params, z. B. "new". */
  queryKey: string
  /** Erwarteter Wert (Default: "1"). Andere Werte oder null triggern nicht. */
  expectedValue?: string
  /** Wird genau einmal gefeuert, wenn der Query passt. */
  onTrigger: () => void
  /** Override fuer Tests. Production: useRoute(). */
  route?: QueryRouteLike
  /** Override fuer Tests. Production: useRouter(). */
  router?: QueryRouterLike
}

export function useQueryTrigger({
  queryKey,
  expectedValue = '1',
  onTrigger,
  route,
  router,
}: UseQueryTriggerOptions): void {
  // SSR ueberspringen: dort hat der Trigger keine sichtbare Wirkung und
  // `router.replace` wuerde ins Leere laufen. Client-Hook reicht.
  if (import.meta.server) return

  // useRoute() / useRouter() sind Nuxt-Auto-Imports. In Tests ohne Nuxt-
  // Kontext muessen route/router explizit injiziert werden (siehe __tests__).
  const resolvedRoute = route ?? (useRoute() as unknown as QueryRouteLike)
  const resolvedRouter = router ?? (useRouter() as unknown as QueryRouterLike)

  // Per-Instance-Guard: in der gleichen Page-Lifetime darf der Trigger
  // nur einmal feuern, auch wenn der Query erneut gesetzt wird.
  const consumed = ref(false)

  watch(
    () => resolvedRoute.query[queryKey],
    (value) => {
      if (consumed.value) return
      if (value !== expectedValue) return
      consumed.value = true
      onTrigger()
      // Nur den Trigger-Key rauswerfen, andere Query-Params (z. B. ?month)
      // bleiben unberuehrt. Rest-Spread loescht den Eintrag sauber.
      const nextQuery: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(resolvedRoute.query)) {
        if (key === queryKey) continue
        nextQuery[key] = val
      }
      resolvedRouter.replace({ query: nextQuery })
    },
    { immediate: true },
  )
}
