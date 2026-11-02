/*
 * useQuickCapture — globaler Erfassen-Dialog fuer Ausgaben & Einnahmen
 * (issue #91).
 *
 * Die haeufigste Aktion der App — eine Buchung erfassen — soll von
 * JEDER Seite aus moeglich sein, ohne vorher zu /transactions/* zu
 * navigieren. Bisher gab es das nur page-lokal (?new=1 + useQueryTrigger)
 * bzw. auf Mobile ueber den FAB (der aber navigiert hat).
 *
 * Architektur analog zu useAskConfirm / ConfirmSheetRoot:
 *   - Dieses Composable haelt NUR den State (via useState, global).
 *   - <QuickCaptureRoot> (einmal in app.vue gemountet) hoert darauf,
 *     rendert den FormDialog und macht den POST.
 *   - Nach Erfolg bumpt <QuickCaptureRoot> `savedTick`. Seiten, die
 *     eine Liste zeigen (expenses/income/index), watchen den Tick und
 *     laden neu — so bleibt die sichtbare Liste konsistent, egal von
 *     wo die Buchung kam.
 *
 * Bewusst NICHT abgedeckt: Sparbuchungen. Die brauchen Goal-Auswahl +
 * Richtung (Einzahlen/Entnehmen) und haben keinen einzelnen primaeren
 * Create-Flow — der FAB/das Menue verlinkt dafuer weiter auf
 * /budgeting/envelopes (unveraendert).
 */
import { computed } from 'vue'
import { useState } from '#app'

export type QuickCaptureKind = 'expense' | 'income' | 'transfer'

type QuickCaptureState = {
  open: boolean
  kind: QuickCaptureKind
  /**
   * Vorausgewaehlter Umschlag fuer den naechsten Open-Aufruf (z. B. von
   * einer Karte auf dem Dashboard).
   * relevant — <QuickCaptureRoot> ignoriert es bei Einnahmen.
   */
  envelopeId: string | null
}

export function useQuickCapture() {
  const state = useState<QuickCaptureState>('quick-capture:state', () => ({
    open: false,
    kind: 'expense',
    envelopeId: null,
  }))

  // Monoton steigender Zaehler, den <QuickCaptureRoot> nach jedem
  // erfolgreichen POST erhoeht. Listen-Seiten watchen ihn als
  // "irgendwo wurde was gebucht"-Signal.
  const savedTick = useState<number>('quick-capture:saved-tick', () => 0)

  const isOpen = computed(() => state.value.open)
  const kind = computed(() => state.value.kind)
  const envelopeId = computed(() => state.value.envelopeId)

  /**
   * Oeffnet den Erfassen-Dialog. Default-Art: Ausgabe. `envelopeId`
   * (optional) fuellt das Umschlag-Feld vor — z. B. beim Klick auf die
   * "+"-Aktion einer Dashboard-Budget-Karte.
   */
  function open(nextKind: QuickCaptureKind = 'expense', options?: { envelopeId?: string | null }) {
    state.value = { open: true, kind: nextKind, envelopeId: options?.envelopeId ?? null }
  }

  function close() {
    state.value = { ...state.value, open: false }
  }

  /** Wechselt die Art, ohne den Open-State zu beruehren (In-Dialog-Toggle). */
  function setKind(nextKind: QuickCaptureKind) {
    state.value = { ...state.value, kind: nextKind }
  }

  /** Von <QuickCaptureRoot> nach erfolgreichem POST aufgerufen. */
  function markSaved() {
    savedTick.value += 1
  }

  return { isOpen, kind, envelopeId, savedTick, open, close, setKind, markSaved }
}
