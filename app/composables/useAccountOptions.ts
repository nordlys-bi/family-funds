/*
 * useAccountOptions — Konten fuer "Bezahlt mit" (ADR-0006, issue #190).
 * Bewusst page-lokal und ohne useState wie `useEnvelopeOptions`: Formulare
 * laden beim Oeffnen frisch, ein neues Konto ist so sofort waehlbar.
 *
 * Bei einem Fehler bleibt die Liste leer; das Formular blendet das Feld dann
 * aus, und der Server meldet, falls ein Konto fehlt.
 */
import { ref } from 'vue'
import type { PaidWithAccount } from '~/utils/account-options'

export type AccountListItem = PaidWithAccount & {
  openingBalance: number
  balance: number
  hasBookings: boolean
}

export function useAccountOptions() {
  const accounts = ref<AccountListItem[]>([])
  /** Standardkonto des angemeldeten Mitglieds. */
  const memberDefaultId = ref<string | null>(null)
  const failed = ref(false)
  const loaded = ref(false)

  async function load(householdId: string | null) {
    if (!householdId) return
    loaded.value = false
    failed.value = false
    try {
      const data = await $fetch<{ accounts: AccountListItem[]; defaultAccountId: string | null }>(`/api/households/${householdId}/accounts`)
      accounts.value = data.accounts
      memberDefaultId.value = data.defaultAccountId
      loaded.value = true
    } catch {
      accounts.value = []
      memberDefaultId.value = null
      failed.value = true
    }
  }

  return { accounts, memberDefaultId, loaded, failed, load }
}
