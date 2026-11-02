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
  // Erst nach dem ersten erfolgreichen Laden ist die Options-Liste
  // aussagekraeftig; vorher darf keine Auswahl als ungueltig gelten.
  const loaded = ref(false)

  async function load(householdId: string | null) {
    if (!householdId) return
    try {
      const data = await $fetch<{ envelopes: BookableEnvelope[]; unassigned: { free: number } }>(
        `/api/households/${householdId}/envelopes`,
      )
      envelopes.value = sortEnvelopes(data.envelopes)
      unassignedFree.value = data.unassigned.free
      loaded.value = true
    } catch {
      envelopes.value = []
      unassignedFree.value = null
    }
  }

  return { envelopes, unassignedFree, loaded, load }
}
