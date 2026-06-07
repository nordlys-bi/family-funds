import { computed } from 'vue'
import { useState } from '#app'
import { useAuth as useClerkAuth } from '@clerk/vue'
import type { UserSession } from '~/types/auth'

export const useAppAuth = () => {
  const user = useState<UserSession | null>('auth-user', () => null)
  const loading = useState<boolean>('auth-loading', () => false)
  const config = useRuntimeConfig()
  const isClerkMode = config.public.authMode === 'clerk'
  const clerkAuth = isClerkMode ? useClerkAuth() : null

  const isLoggedIn = computed(() => !!user.value)

  const fetchUser = async () => {
    if (user.value) return

    if (isClerkMode && clerkAuth?.isLoaded.value && !clerkAuth.isSignedIn.value) {
      user.value = null
      return
    }

    loading.value = true
    try {
      const data = await $fetch<{ user: UserSession | null }>('/api/auth/session')
      user.value = data.user
    } catch (error) {
      console.error('Failed to fetch user session:', error)
      user.value = null
    } finally {
      loading.value = false
    }
  }

  const login = async (userId: string) => {
    if (isClerkMode) {
      throw new Error('Mock login is disabled in Clerk mode')
    }

    loading.value = true
    try {
      const data = await $fetch<{ success: boolean; user: UserSession }>('/api/auth/login', {
        method: 'POST',
        body: { userId },
      })
      if (data.success) {
        user.value = data.user
        // Initialize household context after login
        const { fetchHouseholds } = useHousehold()
        await fetchHouseholds()
      }
      return data
    } catch (error: any) {
      console.error('Login failed:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  const logout = async () => {
    loading.value = true
    try {
      if (isClerkMode && clerkAuth?.signOut?.value) {
        await clerkAuth.signOut.value()
      } else {
        await $fetch('/api/auth/logout', { method: 'POST' })
      }

      user.value = null

      // Clear household state
      const { clearHousehold } = useHousehold()
      clearHousehold()

      // Redirect to login page
      await navigateTo('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      loading.value = false
    }
  }

  return {
    user,
    loading,
    isLoggedIn,
    fetchUser,
    login,
    logout,
  }
}
