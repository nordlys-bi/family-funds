/*
 * useOnboarding — State-Machine fuer die Onboarding-Tour (issue #16).
 *
 * Verwaltet:
 *  - `currentStep`: aktuell angezeigter Step (oder 'done')
 *  - `completedSteps`: Set<StepId> der abgeschlossenen Steps
 *  - `skipped`: User hat explizit "Setup später" gewaehlt
 *  - `progress`: 0-100% (Anzahl completedSteps / 4)
 *
 * Persistenz: State wird bei jeder Aenderung an
 * `PATCH /api/user/onboarding` geschickt. Beim Login wird der State
 * einmal via `GET /api/user/onboarding` geladen.
 *
 * Trigger-Logik (`shouldAutoTrigger`):
 *  - User ist eingeloggt UND
 *  - User hat NICHT explizit geskippt UND
 *  - noch nicht alle 4 Steps abgeschlossen UND
 *  - aktiver Haushalt hat < 1 Mitglied ODER < 1 Budget ODER < 1 Transaktion
 *
 * Bewusst KEIN useState() mit globalem Key: die Tour-Visibility ist
 * Page-/Layout-scoped (default.vue rendert das Tour-Modal), und der
 * State wird eh pro-User serverseitig persistiert.
 */

import { computed, ref } from 'vue'

export const ONBOARDING_STEPS = [
  'household',
  'invite',
  'budget',
  'transaction',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export type OnboardingState = {
  completedSteps: OnboardingStep[]
  skipped: boolean
}

export type HouseholdActivity = {
  memberCount: number
  budgetCount: number
  transactionCount: number
}

export type UseOnboardingReturn = ReturnType<typeof useOnboarding>

export function useOnboarding() {
  const completedSteps = ref<OnboardingStep[]>([])
  const skipped = ref(false)
  const isActive = ref(false) // zeigt das Modal aktuell?
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Lädt den Onboarding-State vom Server. Wird vom Layout nach
   * `fetchUser()` aufgerufen, sobald der User eingeloggt ist.
   */
  async function load(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const data = await $fetch<{ data: OnboardingState }>('/api/user/onboarding')
      completedSteps.value = data.data.completedSteps
      skipped.value = data.data.skipped
    } catch (caught: any) {
      error.value = caught?.statusMessage ?? caught?.message ?? 'Unbekannter Fehler'
      completedSteps.value = []
      skipped.value = false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Entscheidet, ob die Tour auto-getriggert werden soll.
   * Aufgerufen vom Layout direkt nach `load()`.
   *
   * "leerer Haushalt" = < 1 Mitglied (Owner-only zaehlt mit, aber
   * Solo-Owner ohne weitere Aktivitaet soll auch die Tour sehen).
   */
  function shouldAutoTrigger(activity: HouseholdActivity | null): boolean {
    if (skipped.value) return false
    if (completedSteps.value.length >= ONBOARDING_STEPS.length) return false
    if (activity === null) return true // kein Haushalt → Tour muss zeigen
    return (
      activity.memberCount < 1 ||
      activity.budgetCount < 1 ||
      activity.transactionCount < 1
    )
  }

  /**
   * Oeffnet das Tour-Modal. Idempotent.
   */
  function start(): void {
    if (completedSteps.value.length >= ONBOARDING_STEPS.length) {
      // Alle Steps schon done → nichts zu zeigen.
      isActive.value = false
      return
    }
    isActive.value = true
  }

  /**
   * Schliesst das Tour-Modal ohne Skip. State bleibt unveraendert,
   * sodass ein Reload die Tour wieder zeigt (sofern Auto-Trigger
   * weiterhin zutrifft).
   */
  function close(): void {
    isActive.value = false
  }

  /**
   * Markiert einen Step als abgeschlossen und persistiert.
   * Idempotent: bereits abgeschlossene Steps bleiben drin.
   */
  async function markComplete(step: OnboardingStep): Promise<void> {
    if (completedSteps.value.includes(step)) return
    const next = [...completedSteps.value, step]
    completedSteps.value = next
    await persist({ completedSteps: next })

    // Wenn alle Steps fertig: Modal schliessen.
    if (next.length >= ONBOARDING_STEPS.length) {
      isActive.value = false
    }
  }

  /**
   * Markiert die Tour als explizit uebersprungen und persistiert.
   * Ab dann kein Auto-Trigger mehr (nur via "Hilfe → Onboarding wiederholen").
   */
  async function skipTour(): Promise<void> {
    skipped.value = true
    isActive.value = false
    await persist({ skipped: true })
  }

  /**
   * Setzt Skip-Flag zurueck (fuer "Hilfe → Onboarding wiederholen").
   * Loescht auch completedSteps, damit die Tour von vorne startet.
   */
  async function restartTour(): Promise<void> {
    skipped.value = false
    completedSteps.value = []
    isActive.value = true
    await persist({ skipped: false, completedSteps: [] })
  }

  const progress = computed(() =>
    Math.round((completedSteps.value.length / ONBOARDING_STEPS.length) * 100),
  )

  const isComplete = computed(
    () => completedSteps.value.length >= ONBOARDING_STEPS.length,
  )

  return {
    completedSteps,
    skipped,
    isActive,
    isLoading,
    error,
    progress,
    isComplete,
    load,
    shouldAutoTrigger,
    start,
    close,
    markComplete,
    skipTour,
    restartTour,
  }
}

/**
 * Persistiert den State. Bewusst eine freie Funktion, damit sie
 * von markComplete / skipTour / restartTour ohne zirkulaere Refs
 * aufgerufen werden kann.
 */
async function persist(patch: Partial<OnboardingState>): Promise<void> {
  try {
    await $fetch('/api/user/onboarding', {
      method: 'PATCH',
      body: patch,
    })
  } catch (caught: any) {
    // Persist-Fehler werden nicht an UI durchgereicht — naechster
    // Reload liest den State vom Server und konsolidiert.
    // (Local State bleibt korrekt; Server ist nur "langsamer".)
    console.error('[useOnboarding] persist failed:', caught)
  }
}