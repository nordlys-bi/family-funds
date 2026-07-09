<script setup lang="ts">
/**
 * Clerk-mode login card. Only ever rendered in Clerk mode — the
 * parent `<LazyClerkLoginCard v-if="isClerkMode">` ensures the chunk
 * (and its template compilation, which references the `<SignIn>`
 * auto-import from `@clerk/nuxt`) is never loaded in mock mode.
 *
 * Card-Chrome (background, header, logo, brand-title) lebt jetzt
 * zentral in `LoginCard.vue` — wir liefern hier nur den Clerk-`<SignIn>`-
 * Slot.
 */
</script>

<template>
  <LoginCard sub-title="Login mit Clerk" max-width="560px">
    <div class="clerk-signin-shell">
      <SignIn routing="path" path="/login" :fallback-redirect-url="'/'" />
    </div>
  </LoginCard>
</template>

<style scoped>
.clerk-signin-shell {
  display: flex;
  justify-content: center;
  width: 100%;
}
</style>
