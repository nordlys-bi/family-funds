<!--
  LoginCard — gemeinsamer Card-Chrome fuer den Login-Flow.

  Wird von `pages/login.vue` (Mock-Mode) und `ClerkLoginCard.vue`
  (Clerk-Mode) als Slot-Wrapper benutzt. Visuell identisches Frame
  und Login-Header, Inhalt unterscheidet sich je nach Modus.

  Verwendung:
  <LoginCard sub-title="Entwickler-Sandbox &amp; Login">
    <Form ...>
      ...Form-Fields...
    </Form>
  </LoginCard>
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    /**
     * Sub-Header unter "Family Funds" — z. B. "Entwickler-Sandbox",
     * "Login mit Clerk". Default im Mock-Mode-Slot.
     */
    subTitle?: string
    /**
     * Maximale Breite der Karte. Clerk braucht mehr Platz als Mock
     * (~ 560px vs. 460px).
     */
    maxWidth?: string
  }>(),
  { subTitle: '', maxWidth: '460px' },
)
</script>

<template>
  <Card class="login-card">
    <template #title>
      <div class="login-header">
        <div class="logo-container">
          <i class="pi pi-shield logo-icon"></i>
        </div>
        <h1 class="brand-title">Family Funds</h1>
        <p v-if="subTitle" class="brand-subtitle">{{ subTitle }}</p>
      </div>
    </template>

    <template #content>
      <slot />
    </template>
  </Card>
</template>

<style scoped>
.login-card {
  position: relative;
  z-index: 1;
  max-width: v-bind(maxWidth);
  width: 100%;
  border-radius: 20px;
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 0.3),
    0 8px 10px -6px rgb(0 0 0 / 0.3);
  color: #f8fafc;
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
</style>
