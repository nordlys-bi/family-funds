import Aura from '@primeuix/themes/aura'

// https://nuxt.com/docs/api/configuration/nuxt-config

// Determine auth mode at build time
const clerkPublishableKey = process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
const clerkSecretKey = process.env.NUXT_CLERK_SECRET_KEY || ''
const clerkWebhookSigningSecret = process.env.NUXT_CLERK_WEBHOOK_SIGNING_SECRET || ''
const isClerkEnabled = !!(clerkPublishableKey && clerkSecretKey)

const modules: string[] = ['@primevue/nuxt-module']
if (isClerkEnabled) {
  modules.push('@clerk/nuxt')
}

// Verhindert einen Dark->Light-Flash beim Laden (issue "Theme: OS-Farbschema
// als Default, manuell umstellbar"): der Server kennt weder localStorage
// noch die OS-Praeferenz und rendert <html> deshalb immer mit dem
// Dark-Default (siehe app.vue). Dieses Inline-Script laeuft synchron im
// <head> — also VOR dem ersten Paint — und korrigiert die Klassen/das
// data-theme-Attribut, falls Light aktiv ist. Muss dieselbe Lese-Logik wie
// app/composables/useTheme.ts verwenden (Storage-Key + matchMedia-Query),
// sonst driften Erst-Paint und Vue-State auseinander.
const themeInitScript = `(function(){try{var k='family-funds-theme';var s=localStorage.getItem(k);var p=(s==='light'||s==='dark')?s:'system';var isLight=p==='light'||(p==='system'&&window.matchMedia('(prefers-color-scheme: light)').matches);var h=document.documentElement;h.classList.add('my-app');if(isLight){h.setAttribute('data-theme','light');h.classList.remove('my-app-dark');}else{h.classList.add('my-app-dark');h.removeAttribute('data-theme');}}catch(e){}})();`

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules,

  app: {
    head: {
      script: [
        {
          key: 'theme-init',
          innerHTML: themeInitScript,
        },
      ],
    },
  },

  // Clerk configuration (only relevant when @clerk/nuxt is loaded)
  ...(isClerkEnabled
    ? {
        clerk: {
          skipServerMiddleware: true, // We manage our own auth middleware (dual-mode)
          signInFallbackRedirectUrl: '/',
          signUpFallbackRedirectUrl: '/',
        },
      }
    : {}),

  primevue: {
    options: {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.my-app-dark',
        },
      }
    },
    // Komponenten, die das @primevue/nuxt-Modul registrieren soll.
    // PrimeVue 4 Nuxt-Modul registriert ohne explizites `include`
    // ueberhaupt KEINE Components automatisch — die App muss
    // jede genutzte Component listen. Ohne 'Toast' rendert `<Toast />`
    // als unbekanntes Component und der Page-Setup crashed.
    //
    // Format: Array von Component-Namen (case-insensitive). Das
    // PrimeVue-Module resolved die Pfade selbst ueber sein Metadata-Paket.
    //
    // (issue #58: Soft-Delete mit Undo-Banner braucht `<Toast />`.)
    components: {
      include: ['Toast'],
    },
  },
  css: [
    'primeicons/primeicons.css',
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/login.css',
  ],

  runtimeConfig: {
    // Server-only keys (not exposed to client)
    clerkSecretKey,
    clerkWebhookSecret: clerkWebhookSigningSecret,
    // Public keys (exposed to client)
    public: {
      clerkPublishableKey,
      authMode: isClerkEnabled ? 'clerk' : 'mock',
    },
  },
})
