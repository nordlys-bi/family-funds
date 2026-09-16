/*
 * useInlineEditing — geteilter Flag, ob GERADE irgendwo eine Buchung
 * inline bearbeitet wird (Ausgaben-/Einnahmen-Liste).
 *
 * Grund: der mobile FAB Speed-Dial ist `position: fixed` unten rechts
 * mit z-index 1200 (siehe FabSpeedDial.vue) — hoeher als alles auf der
 * Seite. `TransactionRowEditor`s Speichern/Abbrechen-Buttons sind
 * ebenfalls rechtsbuendig (`.row-editor__actions { justify-content:
 * flex-end }`). Landet eine bearbeitete Zeile weit genug unten (kurze
 * Liste, kleiner Viewport), ueberlappen sich beide rechtsbuendigen
 * Button-Reihen — ein Tap trifft dann den FAB statt Speichern/
 * Abbrechen und oeffnet stattdessen den globalen Erfassen-Dialog.
 *
 * Fix: expenses.vue/income.vue spiegeln ihren lokalen
 * editingTransactionId-State hier rein; das Default-Layout blendet den
 * FAB zusaetzlich zum bestehenden `!quickCaptureDialogOpen`-Check
 * waehrend aktiver Inline-Bearbeitung aus.
 */
import { computed } from 'vue'
import { useState } from '#app'

export function useInlineEditing() {
  // `count` statt eines einzelnen Booleans/einer einzelnen ID, falls je
  // mehr als eine Quelle gleichzeitig eine Bearbeitung offen haelt —
  // ein einfaches Bool koennte sich sonst gegenseitig ueberschreiben.
  const count = useState<number>('inline-editing:count', () => 0)
  const isActive = computed(() => count.value > 0)

  function start() {
    count.value += 1
  }

  function stop() {
    count.value = Math.max(0, count.value - 1)
  }

  return { isActive, start, stop }
}
