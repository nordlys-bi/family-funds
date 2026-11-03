/*
 * useEnvelopeOptions — Umschlaege und "Zu verteilen" fuer Buchungsformulare
 * (ADR-0005). Bewusst page-lokal und ohne useState: Die Salden aendern sich
 * mit jeder Buchung, die Formulare laden deshalb beim Oeffnen frisch.
 *
 * Bei einem Fehler bleibt die Liste leer: "Zu verteilen" ist dann die einzige
 * Option und das Formular bleibt benutzbar.
 */
import { ref } from 'vue'
import { sortEnvelopes, type EnvelopeOption } from '~/utils/envelope-options'

export type BookableEnvelope = EnvelopeOption & { balance: { balance: number } }

export function useEnvelopeOptions() {
  const envelopes = ref<BookableEnvelope[]>([])
  /** Freies Geld in "Zu verteilen"; null, solange nichts geladen ist. */
  const unassignedFree = ref<number | null>(null)
  /** Start von "Zu verteilen"; null, solange nichts geladen ist. */
  const ledgerSince = ref<string | null>(null)
  const failed = ref(false)
  // Erst nach dem ersten erfolgreichen Laden ist die Options-Liste
  // aussagekraeftig; vorher darf keine Auswahl als ungueltig gelten.
  const loaded = ref(false)

  async function load(householdId: string | null) {
    if (!householdId) return
    // Waehrend des Ladens und nach einem Fehler sagt die Liste nichts ueber die
    // Auswahl aus: Ein gueltiger Umschlag darf deshalb nicht verworfen werden.
    loaded.value = false
    failed.value = false
    try {
      const data = await $fetch<{ envelopes: BookableEnvelope[]; unassigned: { free: number; ledgerSince: string } }>(
        `/api/households/${householdId}/envelopes`,
      )
      envelopes.value = sortEnvelopes(data.envelopes)
      unassignedFree.value = data.unassigned.free
      ledgerSince.value = data.unassigned.ledgerSince
      loaded.value = true
    } catch {
      envelopes.value = []
      unassignedFree.value = null
      failed.value = true
    }
  }

  return { envelopes, unassignedFree, ledgerSince, loaded, failed, load }
}
