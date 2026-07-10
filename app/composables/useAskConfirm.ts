/*
 * useAskConfirm — Promise-basierter Confirm-Dialog (issue #51).
 *
 * Bisher hatte jede Page ihren eigenen pendingConfirm-Ref +
 * askConfirm-Funktion (siehe z.B. `app/pages/households/members.vue`
 * Zeile 65-100). Das war Copy-Paste. Mit diesem Composable gibt es
 * EINE globale Instanz des Sheets (gerendert von
 * <ConfirmSheetRoot /> in `app/app.vue`), und jede Page kann mit
 *
 *     const confirm = useAskConfirm()
 *     const ok = await confirm.ask({
 *       title: 'Budget l\u00f6schen?',
 *       message: '\u201eLebensmittel\u201c wird entfernt. Bereits gebuchte Ausgaben
 *                 behalten das Budget-Label, der Topf-Betrag wird zur\u00fcckgerechnet.',
 *       tone: 'danger',
 *       confirmLabel: 'Endg\u00fcltig l\u00f6schen',
 *     })
 *     if (!ok) return
 *
 * einen Dialog \u00f6ffnen. Der Promise resolved mit `true` bei Confirm,
 * `false` bei Cancel.
 *
 * Globaler State via `useState('confirm:pending', ...)` — nur EIN
 * Confirm-Dialog kann gleichzeitig offen sein, und der State
 * \u00fcberlebt Page-Wechsel (z. B. wenn der User w\u00e4hrend eines offenen
 * Dialogs woanders hin navigiert, schlie\u00dft sich der Dialog).
 *
 * Naming: NICHT `useConfirm` — PrimeVue hat ein eigenes useConfirm
 * (ConfirmationService-Pattern, braucht `ConfirmationService` als
 * Provide), und der Name-Kollision fuehrt zu einem harten 500-Crash
 * beim App-Mount, weil PrimeVue's useConfirm ohne Provide wirft.
 * `useAskConfirm` ist eindeutig und beschreibt das Pattern: "Ask the
 * user for confirmation, then do the thing".
 *
 * Tests: `useAskConfirm.test.ts`. Mocking in Page-Tests via
 * `vi.mock('~/composables/useAskConfirm', ...)` — nicht zwingend, weil
 * `ask()` ohne pendingConfirm.resolve einfach h\u00e4ngt (wir testen die
 * Composables direkt).
 */

import { useState } from '#app'

export type ConfirmRequest = {
  /** Kurze Frage, z. B. "Budget l\u00f6schen?". */
  title: string
  /** L\u00e4ngere Erkl\u00e4rung, was beim Confirm passiert. */
  message: string
  /** Visueller Ton des Confirm-Buttons. */
  tone: 'primary' | 'danger'
  /** Text auf dem Confirm-Button. Default: "Best\u00e4tigen". */
  confirmLabel?: string
  /** Text auf dem Cancel-Button. Default: "Abbrechen". */
  cancelLabel?: string
}

type PendingConfirm = {
  request: ConfirmRequest
  resolve: (ok: boolean) => void
}

export function useAskConfirm() {
  // Globaler Pending-State. Null = kein Dialog offen. Wir teilen den
  // State zwischen allen useAskConfirm()-Calls in der App via useState.
  const pending = useState<PendingConfirm | null>('confirm:pending', () => null)

  /**
   * \u00d6ffnet den Confirm-Dialog und gibt einen Promise zur\u00fcck, der mit
   * `true` (Best\u00e4tigt) oder `false` (Abgebrochen) resolved.
   *
   * Reihenfolge-Logik: Wenn schon ein Confirm offen ist, brechen wir
   * den bestehenden mit `false` ab (Caller hat sich offenbar aufgel\u00f6st
   * oder ist in einen Fehler-State gelaufen). Verhindert "festgefahrene"
   * Dialogs bei kaputten Caller-Code-Pfaden.
   */
  function ask(request: ConfirmRequest): Promise<boolean> {
    if (pending.value) {
      // Alter Dialog wird aufgel\u00f6st (false = nicht best\u00e4tigt), bevor
      // wir den neuen anlegen. Caller-Code, der awaitet, sieht ein
      // sauberes "cancel" statt Promise-Block.
      pending.value.resolve(false)
      pending.value = null
    }
    return new Promise((resolve) => {
      pending.value = { request, resolve }
    })
  }

  /** Best\u00e4tigt den aktuell offenen Dialog. Idempotent wenn nichts offen. */
  function confirm() {
    if (pending.value) {
      pending.value.resolve(true)
      pending.value = null
    }
  }

  /** Bricht den aktuell offenen Dialog ab. Idempotent wenn nichts offen. */
  function cancel() {
    if (pending.value) {
      pending.value.resolve(false)
      pending.value = null
    }
  }

  return { pending, ask, confirm, cancel }
}
