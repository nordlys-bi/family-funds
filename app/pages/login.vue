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
    await navigateTo('/')
  } catch (err: any) {
    errorMsg.value = 'Login fehlgeschlagen: ' + (err.statusMessage || err.message)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await fetchUser()
  if (isLoggedIn.value) {
    await navigateTo('/')
  } else if (!isClerkMode.value) {
    await loadUsers()
  }
})
</script>

<template>
  <div class="login-page">
    <div class="login-page__decorations">
      <div class="login-page__circle login-page__circle--1"></div>
      <div class="login-page__circle login-page__circle--2"></div>
    </div>

    <!--
      Lazy-loaded so the chunk (and its <SignIn> template compilation) is only
      fetched when Clerk mode is actually active. In mock mode this never renders,
      and the `<SignIn>` component — which is auto-imported from @clerk/nuxt and
      doesn't exist when the module isn't loaded — is never referenced.
    -->
    <LazyClerkLoginCard v-if="isClerkMode" />

    <LoginCard v-else sub-title="Entwickler-Sandbox & Login">
      <div class="login-form">
        <Message v-if="errorMsg" severity="error" variant="simple" class="login-form__error">
          {{ errorMsg }}
        </Message>

        <div v-if="loading && mockUsers.length === 0" class="login-form__loader">
          <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" fill="transparent" animationDuration=".5s" />
        </div>

        <template v-else>
          <label for="user-select" class="login-form__label">
            Wähle einen Test-Account:
          </label>
          <Select
            id="user-select"
            v-model="selectedUserId"
            :options="userOptions"
            optionLabel="label"
            optionValue="value"
            class="login-form__select"
          />

          <p class="login-form__info">
            <i class="pi pi-info-circle login-form__info-icon"></i>
            Da keine Clerk-Konfiguration aktiv ist, läuft die Anwendung im <strong>Mock-Modus</strong>. Du kannst dich als jeder der oben gelisteten Test-User anmelden, um Multi-User- und Multi-Household-Szenarien zu simulieren.
          </p>

          <Button
            label="Als Test-User anmelden"
            icon="pi pi-sign-in"
            severity="primary"
            class="login-form__submit"
            :loading="loading"
            @click="handleLogin"
          />
        </template>
      </div>
    </LoginCard>
  </div>
</template>

<style scoped>
/* Form-Layout lebt in login.vue, Decoration-Background in
   app/assets/css/login.css (global). LoginCard-Chrome in LoginCard.vue. */

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.login-form__error {
  margin: 0;
}

.login-form__loader {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1.5rem 0;
}

.login-form__label {
  display: block;
  font-weight: 600;
  font-size: 0.875rem;
  color: #cbd5e1;
}

.login-form__select {
  width: 100%;
}

.login-form__info {
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid #3b82f6;
  padding: 0.75rem 1rem;
  border-radius: 0 8px 8px 0;
  line-height: 1.5;
  color: #93c5fd;
  margin: 0;
  font-size: 0.875rem;
}

.login-form__info-icon {
  margin-right: 0.4rem;
}

.login-form__submit {
  width: 100%;
}
</style>
