<script setup lang="ts">
useHead({
  htmlAttrs: { class: 'my-app-dark' },
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
