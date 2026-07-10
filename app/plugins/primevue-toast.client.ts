/*
 * PrimeVue ToastService Plugin (issue #58)
 *
 * PrimeVue 4 hat `primevue/toastservice` als separates Service-Modul,
 * das explizit per `app.use()` registriert werden muss. Das Nuxt-Modul
 * `@primevue/nuxt-module` registriert NICHT alle PrimeVue-Services
 * automatisch — nur die in der `components`-Liste konfigurierten
 * Components. Daher dieses Plugin.
 *
 * Toast ist client-only (kein SSR-Render, kein Bedarf auf Server-Seite).
 * Daher `.client.ts`-Suffix, damit Nuxt das Plugin nur im Browser-Bundle
 * einkompiliert.
 *
 * Mit diesem Plugin kann `useToast()` aus `primevue/usetoast` in jedem
 * Composable/Page aufgerufen werden, ohne dass der Caller den Service
 * selbst registrieren muss.
 */
import ToastService from 'primevue/toastservice'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(ToastService)
})
