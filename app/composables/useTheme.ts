/*
 * useTheme — App-Theme (Hell/Dunkel), folgt standardmaessig dem
 * OS-Farbschema, ist aber manuell auf "Hell"/"Dunkel" fixierbar.
 *
 * Architektur (siehe auch Kommentare in app/assets/css/base.css):
 *   - `preference` ist die Nutzerwahl: 'system' | 'light' | 'dark'.
 *   - `effective` ist das daraus + der aktuellen OS-Praeferenz berechnete
 *     tatsaechliche Theme ('light' | 'dark').
 *   - `htmlClass`/`htmlDataTheme` sind die daraus abgeleiteten Attribute
 *     fuer <html>: `my-app` ist immer gesetzt (theme-neutrale Basis fuer
 *     base.css), `my-app-dark` steuert zusaetzlich PrimeVues eigenes
 *     Dark-Preset (`darkModeSelector` in nuxt.config.ts), `data-theme="light"`
 *     aktiviert die Light-Werte aus tokens.css/base.css.
 *
 * Persistenz: nur `localStorage`, bewusst kein Cookie/Server-Sync (siehe
 * Issue-Diskussion) — die Wahl gilt pro Geraet/Browser.
 *
 * Flackern beim Laden: der Server kennt weder localStorage noch die
 * OS-Praeferenz und rendert deshalb immer mit dem Dark-Default (identisch
 * zum bisherigen Verhalten). Ein Inline-Script (nuxt.config.ts, app.head.script)
 * korrigiert `<html>` synchron VOR dem ersten Paint, falls Light aktiv ist.
 * `initClient()` hier synchronisiert danach nur noch den Vue-State, damit
 * spaetere reaktive Aenderungen (Live-OS-Wechsel, Umschalten im UI)
 * konsistent funktionieren — sie darf NICHT das, was das Inline-Script
 * bereits sichtbar gemacht hat, nochmal "umschalten" (deshalb identische
 * Lese-Logik in beiden Stellen).
 *
 * `initClient()` wird bewusst direkt aus app.vue aufgerufen statt aus einem
 * `.client.ts`-Plugin — Nuxt-Plugins haben sich in diesem Projekt als
 * unzuverlaessig erwiesen (siehe Kommentar zur ToastService-Registrierung
 * in app.vue). Sie darf nur EINMAL aufgerufen werden (app.vue ist die
 * Root-Component und wird nur einmal gemountet), sonst haengen mehrere
 * matchMedia-Listener am gleichen Media-Query.
 */

import { computed } from 'vue'
import { useState } from '#app'

export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'family-funds-theme'

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // z. B. Safari Private Mode mit deaktiviertem Storage — Praeferenz
    // gilt dann nur fuer die laufende Session statt dauerhaft.
  }
  return null
}

export function useTheme() {
  const preference = useState<ThemePreference>('theme-preference', () => 'system')
  const systemPrefersLight = useState<boolean>('theme-system-prefers-light', () => false)

  const effective = computed<EffectiveTheme>(() => {
    if (preference.value === 'light') return 'light'
    if (preference.value === 'dark') return 'dark'
    return systemPrefersLight.value ? 'light' : 'dark'
  })

  const htmlClass = computed(() => (effective.value === 'dark' ? 'my-app my-app-dark' : 'my-app'))
  const htmlDataTheme = computed<'light' | undefined>(() =>
    effective.value === 'light' ? 'light' : undefined,
  )

  function setPreference(next: ThemePreference) {
    preference.value = next
    if (import.meta.client) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // s.o. — kein harter Fehler, Praeferenz gilt nur fuer diese Session.
      }
    }
  }

  let mediaQuery: MediaQueryList | null = null
  function onSystemChange(event: MediaQueryListEvent) {
    systemPrefersLight.value = event.matches
  }

  function initClient() {
    if (!import.meta.client) return

    const stored = readStoredPreference()
    if (stored) {
      preference.value = stored
    }

    if (typeof window.matchMedia !== 'function') return
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    systemPrefersLight.value = mediaQuery.matches
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onSystemChange)
    } else {
      // Safari < 14 Fallback
      mediaQuery.addListener(onSystemChange)
    }
  }

  function disposeClient() {
    if (!mediaQuery) return
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', onSystemChange)
    } else {
      mediaQuery.removeListener(onSystemChange)
    }
    mediaQuery = null
  }

  return {
    preference,
    effective,
    htmlClass,
    htmlDataTheme,
    setPreference,
    initClient,
    disposeClient,
  }
}
