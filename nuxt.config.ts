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

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules,

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
    }
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
