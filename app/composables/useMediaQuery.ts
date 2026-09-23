/*
 * useMediaQuery — liest eine CSS-Media-Query live per `matchMedia` und
 * exposiert das Ergebnis als Ref (gleiches Muster wie useReducedMotion).
 *
 * Verwendung:
 *   const isNarrow = useMediaQuery('(max-width: 639px)')
 *
 * SSR-tauglich: auf dem Server (und im ersten Client-Render, damit die
 * Hydration nicht abweicht) ist der Wert `false`; nach dem Mount
 * aktualisiert er sich auf den tatsaechlichen Wert und folgt Aenderungen
 * (Drehen, Fenster skalieren). Rein visuelle Unterschiede gehoeren
 * deshalb in CSS — dieses Composable ist fuer Verhalten, das per JS
 * umschalten muss (z. B. Swipe-Gesten).
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useMediaQuery(query: string) {
  const matches = ref(false)

  if (import.meta.server) return matches

  let mediaQuery: MediaQueryList | null = null
  const onChange = (event: MediaQueryListEvent) => {
    matches.value = event.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    mediaQuery = window.matchMedia(query)
    matches.value = mediaQuery.matches
    mediaQuery.addEventListener('change', onChange)
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', onChange)
    mediaQuery = null
  })

  return matches
}
