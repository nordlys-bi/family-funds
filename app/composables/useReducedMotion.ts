/*
 * useReducedMotion — Composable der `prefers-reduced-motion: reduce`
 * via MatchMedia live liest und als Ref exposiert.
 *
 * Beweggrund: User mit reduzierter Motion-Empfindlichkeit (WCAG 2.3.3,
 * ~ 5-10 % der Nutzer) brauchen Animationen entweder gar nicht oder
 * stark verkuenigt. Statt `window.matchMedia` direkt in jeder
 * Komponente zu pollen, kapseln wir die Logik hier und exposieren
 * ein einzelnes Ref, auf das Vue-Komponenten reagieren koennen.
 *
 * Verwendung:
 *   const reducedMotion = useReducedMotion()
 *   <Transition :duration="reducedMotion ? 0 : 300">
 *     ...
 *   </Transition>
 *
 * SSR-tauglich: auf dem Server ist `matchMedia` nicht verfuegbar, daher
 * Default `false` (Motion aktiv); nach Hydration aktualisiert der
 * EventListener auf den tatsaechlichen User-Wert.
 */

import { onMounted, onBeforeUnmount, ref } from 'vue'

export function useReducedMotion() {
  const prefersReducedMotion = ref(false)

  if (import.meta.server) {
    // Default auf dem Server: Motion an (Vermeidet Flicker bei Hydration
    // wenn User tatsaechlich Motion ausschalten will — er bekommt
    // 1 Frame lang Animation, dann ist es aus).
    return prefersReducedMotion
  }

  let mediaQuery: MediaQueryList | null = null
  const onChange = (event: MediaQueryListEvent) => {
    prefersReducedMotion.value = event.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.value = mediaQuery.matches
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onChange)
    } else {
      // Safari < 14 fallback
      mediaQuery.addListener(onChange)
    }
  })

  onBeforeUnmount(() => {
    if (!mediaQuery) return
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', onChange)
    } else {
      mediaQuery.removeListener(onChange)
    }
    mediaQuery = null
  })

  return prefersReducedMotion
}
