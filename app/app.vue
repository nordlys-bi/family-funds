<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount } from 'vue'
import { useNuxtApp } from '#app'
import ToastService from 'primevue/toastservice'
import { useTheme } from '~/composables/useTheme'

// Theme (Hell/Dunkel, folgt OS-Default): siehe useTheme.ts fuer die volle
// Architektur-Erklaerung. `htmlClass`/`htmlDataTheme` sind reaktiv — sobald
// sich `preference` aendert (User-Toggle) oder die OS-Praeferenz wechselt,
// aktualisiert unhead <html> automatisch.
const { htmlClass, htmlDataTheme, effective, initClient, disposeClient } = useTheme()

// theme-color (issue #123): Browser-UI/Statusleiste soll dem aktuellen
// Theme folgen, nicht dauerhaft auf Dark stehen bleiben. Werte entsprechen
// --color-bg-page in tokens.css fuer dark/light.
const themeColor = computed(() => (effective.value === 'light' ? '#f1f5f9' : '#0b0f19'))

useHead({
  htmlAttrs: { class: htmlClass, 'data-theme': htmlDataTheme },
  meta: [{ name: 'theme-color', content: themeColor, tagPriority: 'critical' }],
})

// PrimeVue 4 ToastService explizit registrieren (issue #58).
//
// Wir versuchten zunaechst ein Nuxt-Plugin in app/plugins/, das hat
// sich aber als unzuverlaessig erwiesen (Vite-Node-Bundling-Eigenheiten
// in Nuxt 4 mit .client.ts-Plugins). Pragmatischer Weg: in der Root-
// Component `app.vue` selbst registrieren.
//
// `useNuxtApp().vueApp` ist die Vue-App-Instance. `.use(ToastService)`
// ruft `ToastService.install(app)` auf, das intern zwei Sachen macht:
//  1. `app.config.globalProperties.$toast = ToastService`
//  2. `app.provide(PrimeVueToastSymbol, ToastService)`
//
// `useToast()` aus `primevue/usetoast` benutzt genau diesen provide,
// deshalb genuegt dieser eine `.use()`-Call, damit `useToast()` in
// allen Composables (useUndoableDelete, useBookingDialog, ...) den
// Service bekommt.
//
// `onBeforeMount` garantiert, dass die Vue-App vollstaendig initialisiert
// ist, bevor wir versuchen, `use()` aufzurufen. Im SSR-Render ueber-
// springen wir den Schritt (Toast ist eh client-only).
onBeforeMount(() => {
  if (!import.meta.client) return
  const { vueApp } = useNuxtApp()
  vueApp.use(ToastService)
  initClient()
})

onBeforeUnmount(() => {
  disposeClient()
})
</script>

<template>
  <div class="app-shell">
    <!-- Injiziert <link rel="manifest">, Favicon/Apple-Touch-Icon/Splash-
         Screen-Links aus public/favicon.svg (issue #123, siehe
         pwa-assets.config.ts). Rendert selbst nichts sichtbares. -->
    <NuxtPwaAssets />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- Globaler Confirm-Dialog-Mount-Point (issue #51). useAskConfirm
         haelt den State, ConfirmSheetRoot hoert darauf und rendert
         den Dialog nur, wenn ein Request pending ist. -->
    <ConfirmSheetRoot />

    <!-- Globaler Erfassen-Dialog (issue #91). useQuickCapture haelt den
         State, QuickCaptureRoot rendert den Dialog + macht den POST.
         Getriggert vom Header-Button, dem Tastenkuerzel "e" und dem
         Mobile-FAB — von jeder Seite aus, ohne Navigation. -->
    <QuickCaptureRoot />
  </div>
</template>

<style>
/* Global foundation styles. PrimeVue-Component-Overrides liegen in ~/assets/css/base.css. */

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background-color: var(--color-bg-page, #0b0f19);
  color-scheme: dark;
}

html[data-theme='light'] {
  color-scheme: light;
}

body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--color-text-primary, #f1f5f9);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app-shell {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 30%), var(--color-bg-page, #0b0f19);
}
</style>
