import { computed } from 'vue'
import { useState, useCookie } from '#app'

export interface HouseholdInfo {
  id: string
  name: string
  currency: string
  role: 'OWNER' | 'MEMBER'
}

export const useHousehold = () => {
  const households = useState<HouseholdInfo[]>('user-households', () => [])
  const activeHousehold = useState<HouseholdInfo | null>('active-household', () => null)
  const loading = useState<boolean>('household-loading', () => false)

  // Persist the active household ID in a cookie
  const activeHouseholdIdCookie = useCookie<string | null>('active_household_id', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })

  const fetchHouseholds = async () => {
    loading.value = true
    try {
      // Im SSR leitet `$fetch` keine Cookies weiter — wir müssen den
      // Cookie-Header explizit aus dem aktuellen Request übernehmen,
      // sonst sieht `/api/households` den User nicht und antwortet mit
      // { households: [] }.
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      const data = await $fetch<{ households: HouseholdInfo[] }>('/api/households', {
        headers,
      })
      households.value = data.households

      if (households.value.length > 0) {
        // Try to restore previous selection
        const prevId = activeHouseholdIdCookie.value
        const matched = households.value.find((h) => h.id === prevId)

        if (matched) {
          activeHousehold.value = matched
        } else {
          // Default to first household
          activeHousehold.value = households.value[0]
          activeHouseholdIdCookie.value = households.value[0].id
        }
      } else {
        activeHousehold.value = null
        activeHouseholdIdCookie.value = null
      }
    } catch (error) {
      console.error('Failed to fetch households:', error)
      households.value = []
      activeHousehold.value = null
      activeHouseholdIdCookie.value = null
    } finally {
      loading.value = false
    }
  }

  const setActiveHousehold = (householdId: string) => {
    const matched = households.value.find((h) => h.id === householdId)
    if (matched) {
      activeHousehold.value = matched
      activeHouseholdIdCookie.value = matched.id
    }
  }

  const clearHousehold = () => {
    households.value = []
    activeHousehold.value = null
    activeHouseholdIdCookie.value = null
  }

  return {
    households,
    activeHousehold,
    loading,
    fetchHouseholds,
    setActiveHousehold,
    clearHousehold,
  }
}
