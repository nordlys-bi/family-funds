<script setup lang="ts">
import { onBeforeMount } from 'vue'
import { useNuxtApp } from '#app'
import ToastService from 'primevue/toastservice'

useHead({
  htmlAttrs: { class: 'my-app-dark' },
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
})
</script>

<template>
  <div class="app-shell">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
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
