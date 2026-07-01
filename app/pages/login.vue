<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

definePageMeta({
  layout: false, // Don't use default layout for login page
})

const { login, isLoggedIn, fetchUser } = useAppAuth()
const config = useRuntimeConfig()

const isClerkMode = computed(() => config.public.authMode === 'clerk')
const mockUsers = ref<{ id: string; displayName: string; email: string }[]>([])
const selectedUserId = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const userOptions = computed(() =>
  mockUsers.value.map((user) => ({
    label: `${user.displayName || 'Unbenannt'} (${user.email})`,
    value: user.id,
  })),
)

const loadUsers = async () => {
  if (isClerkMode.value) return

  loading.value = true
  try {
    const data = await $fetch<{ users: typeof mockUsers.value }>('/api/auth/mock-users')
    mockUsers.value = data.users
    if (data.users.length > 0) {
      selectedUserId.value = data.users[0].id
    }
  } catch (err: any) {
    errorMsg.value = 'Fehler beim Laden der Test-Benutzer: ' + (err.statusMessage || err.message)
  } finally {
    loading.value = false
  }
}

const handleLogin = async () => {
  if (isClerkMode.value) return

  if (!selectedUserId.value) return
  loading.value = true
  errorMsg.value = null
  try {
    await login(selectedUserId.value)
    // Redirect to home/dashboard
    await navigateTo('/')
  } catch (err: any) {
    errorMsg.value = 'Login fehlgeschlagen: ' + (err.statusMessage || err.message)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // If already logged in, redirect to index
  await fetchUser()
  if (isLoggedIn.value) {
    await navigateTo('/')
  } else if (!isClerkMode.value) {
    await loadUsers()
  }
})
</script>

<template>
  <div class="login-wrapper">
    <div class="background-decorations">
      <div class="circle c1"></div>
      <div class="circle c2"></div>
    </div>

    <!--
      Lazy-loaded so the chunk (and its <SignIn> template compilation) is only
      fetched when Clerk mode is actually active. In mock mode this never renders,
      and the `<SignIn>` component — which is auto-imported from @clerk/nuxt and
      doesn't exist when the module isn't loaded — is never referenced.
    -->
    <LazyClerkLoginCard v-if="isClerkMode" />

    <Card v-else class="login-card p-6">
      <template #title>
        <div class="login-header">
          <div class="logo-container">
            <i class="pi pi-wallet logo-icon"></i>
          </div>
          <h1 class="brand-title">Family Funds</h1>
          <p class="brand-subtitle">Entwickler-Sandbox & Login</p>
        </div>
      </template>

      <template #content>
        <div v-if="errorMsg" class="mb-4">
          <Message severity="error" variant="simple">{{ errorMsg }}</Message>
        </div>

        <div v-if="loading && mockUsers.length === 0" class="flex justify-center items-center py-6">
          <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" fill="transparent" animationDuration=".5s" />
        </div>

        <div v-else class="form-container">
          <label for="user-select" class="block font-semibold mb-2 text-sm text-surface-600 dark:text-surface-400">
            Wähle einen Test-Account:
          </label>
          <div class="select-container">
            <Select
              id="user-select"
              v-model="selectedUserId"
              :options="userOptions"
              optionLabel="label"
              optionValue="value"
              class="custom-select mb-6"
            />
          </div>

          <p class="info-text text-sm text-surface-500 mb-6">
            <i class="pi pi-info-circle mr-1"></i>
            Da keine Clerk-Konfiguration aktiv ist, läuft die Anwendung im **Mock-Modus**. Sie können sich als jeder der oben gelisteten Test-User anmelden, um Multi-User- und Multi-Household-Szenarien zu simulieren.
          </p>

          <Button 
            label="Als Test-User anmelden" 
            icon="pi pi-sign-in" 
            class="w-full login-btn" 
            :loading="loading" 
            @click="handleLogin" 
          />
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.login-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  font-family: var(--font-family, 'Inter', sans-serif);
  padding: 1.5rem;
  overflow: hidden;
}

.background-decorations {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.15;
}

.c1 {
  width: 400px;
  height: 400px;
  background: #3b82f6;
  top: -100px;
  right: -50px;
}

.c2 {
  width: 500px;
  height: 500px;
  background: #a855f7;
  bottom: -150px;
  left: -100px;
}

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

.form-container {
  display: flex;
  flex-direction: column;
}

.select-container {
  position: relative;
}

.custom-select {
  width: 100%;
}

:deep(.custom-select.p-select) {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
}

:deep(.custom-select .p-select-label) {
  color: #f8fafc;
  font-weight: 600;
}

:deep(.custom-select .p-select-dropdown) {
  color: #cbd5e1;
}

.info-text {
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid #3b82f6;
  padding: 0.75rem 1rem;
  border-radius: 0 8px 8px 0;
  line-height: 1.5;
  color: #93c5fd;
}

.login-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%) !important;
  border: none !important;
  font-weight: 600 !important;
  padding: 0.85rem !important;
  border-radius: 10px !important;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2) !important;
  transition: transform 0.2s, box-shadow 0.2s !important;
}

.login-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3) !important;
}

.clerk-signin-shell {
  display: flex;
  justify-content: center;
  width: 100%;
}

.w-full {
  width: 100%;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.mb-6 {
  margin-bottom: 1.5rem;
}

.mr-1 {
  margin-right: 0.25rem;
}

.py-6 {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
}

.flex {
  display: flex;
}

.justify-center {
  justify-content: center;
}

.items-center {
  align-items: center;
}
</style>
