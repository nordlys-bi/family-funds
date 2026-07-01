<script setup lang="ts">
/**
 * Clerk-mode login card. Only ever rendered in Clerk mode — the
 * parent `<LazyClerkLoginCard v-if="isClerkMode">` ensures the chunk
 * (and its template compilation, which references the `<SignIn>`
 * auto-import from `@clerk/nuxt`) is never loaded in mock mode.
 */
</script>

<template>
  <Card class="login-card clerk-card p-6">
    <template #title>
      <div class="login-header">
        <div class="logo-container">
          <i class="pi pi-shield logo-icon"></i>
        </div>
        <h1 class="brand-title">Family Funds</h1>
        <p class="brand-subtitle">Login mit Clerk</p>
      </div>
    </template>

    <template #content>
      <div class="clerk-signin-shell">
        <SignIn routing="path" path="/login" :fallback-redirect-url="'/'" />
      </div>
    </template>
  </Card>
</template>

<style scoped>
.login-card {
  position: relative;
  z-index: 1;
  max-width: 460px;
  width: 100%;
  border-radius: 20px;
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3);
  color: #f8fafc;
}

.clerk-card {
  max-width: 560px;
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.logo-container {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  border-radius: 16px;
  margin-bottom: 1rem;
  box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
}

.logo-icon {
  font-size: 2.2rem;
  color: #ffffff;
}

.brand-title {
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  background: linear-gradient(to right, #3b82f6, #a855f7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.brand-subtitle {
  font-size: 0.9rem;
  color: #94a3b8;
  margin-top: 0.25rem;
  margin-bottom: 0;
}

.clerk-signin-shell {
  display: flex;
  justify-content: center;
  width: 100%;
}
</style>
