/*
 * useUndoableDelete — Soft-Delete mit Undo-Banner (issue #58).
 *
 * Kapselt den ganzen Flow fuer "loeschen + 5 Sekunden rueckgaengig
 * machen koennen", den expenses.vue und income.vue brauchen:
 *
 *  1. delete(item) — server-Call (DELETE), optimistic remove aus der
 *     lokalen Liste, Banner mit "Rueckgaengig"-Button einblenden.
 *  2. undo(item) — POST /restore, bei Erfolg Zeile wieder in die Liste
 *     einfuegen, Banner verschwindet.
 *  3. expireUndo(item) — 5-Sekunden-Timer abgelaufen, kein Hard-Delete
 *     (Variante A, soft-permanent). Eintrag verschwindet aus dem
 *     pending-State, Datensatz bleibt mit deletedAt in der DB.
 *
 * Optimistic mit Rollback: Wenn der DELETE-Call fehlschlaegt, wird
 * die Zeile wiederhergestellt + ein Fehler-Toast gezeigt. Beim RESTORE-
 * Call dasselbe.
 *
 * Composable ist page-scoped (kein useState) — jede Page hat ihren
 * eigenen pending-State. Das ist gewollt, weil die Page-spezifische
 * Item-Liste die Quelle der Wahrheit fuer den restore ist.
 *
 * Dependencies:
 *  - useToast (PrimeVue, registriert in app/plugins/primevue-toast.client.ts)
 *  - $fetch (Nuxt)
 *  - useTransactionList (liefert restoreTransactionLocal + recomputeSummaryFromLocal
 *    fuer die Optimistic-Logik auf der Liste)
 *
 * Test-Strategie (useUndoableDelete.test.ts): useToast wirft ohne
 * `provide()`-Setup in Vitest, daher wird der Toast optional
 * aufgerufen (try/catch). Im Production-Pfad (mit Plugin) ist
 * PrimeVue-Toast immer verfuegbar.
 */

import { ref, onBeforeUnmount } from 'vue'
import { useToast } from 'primevue/usetoast'

// HINWEIS: useToast wird hier explizit aus primevue/usetoast importiert,
// NICHT via Nuxt-Auto-Import. Grund:
//  - Vitest's `vi.mock('primevue/usetoast', ...)` braucht einen expliziten
//    Import, damit der Mock greift (Auto-Imports werden in Test-Setups
//    nicht zuverlaessig aufgeloest).
//  - Nuxt SSR rendert die Page ohne PrimeVue-Plugin-Setup (Plugin ist
//    `.client.ts`) — `useToast()` wuerde die Setup-Phase crashen. Der
//    try/catch unten faengt das ab und nutzt einen noopToast-Fallback.


export type UndoableDeleteKind = 'expense' | 'income'

export type UndoableDeleteOptions<TItem extends { id: string }> = {
  /** Aktive Household-ID. Wird fuer die URL gebraucht. */
  householdId: () => string | null
  /** Welche Art von Transaktion (steuert Endpoint-Pfade). */
  kind: UndoableDeleteKind
  /**
   * Callback: entfernt das Item aus der lokalen Liste (optimistic).
   * Composable kuemmert sich nicht darum, WIE die Liste verwaltet wird.
   */
  onRemoveLocal: (id: string) => void
  /**
   * Callback: fuegt das Item wieder in die lokale Liste ein (nach Undo).
   * Wird mit dem vollstaendigen Item aus dem Server-Response aufgerufen
   * — falls der Server das vollstaendige Item liefert. Andernfalls
   * bekommt der Caller die zuvor entfernte Original-Transaktion
   * zurueck (zweite Variante unten).
   */
  onRestoreLocal: (item: TItem) => void
  /**
   * Optional: Summary nach Restore neu rechnen, weil sich Betraege
   * aendern koennten. (Fuer Soft-Delete eher unnoetig, weil das
   * Item schon vorher im Summary war — aber konsistent mit dem
   * Inline-Edit-Pattern in expenses.vue.)
   */
  onAfterChange?: () => void
  /**
   * Wie lange der Undo-Banner sichtbar bleibt (ms). Default 5000.
   */
  undoWindowMs?: number
}

export type PendingUndo<TItem extends { id: string }> = {
  item: TItem
  kind: UndoableDeleteKind
  /** ID des Timers, damit wir ihn bei Undo clearen koennen. */
  timerId: ReturnType<typeof setTimeout>
  /** Snapshot fuer Optimistic-Rollback bei Server-Fehler. */
  removedSnapshot: { index: number; item: TItem } | null
}

const UNDO_WINDOW_DEFAULT = 5000

/**
 * No-Op-Toast fuer Faelle, in denen PrimeVue-Toast nicht verfuegbar ist
 * (SSR-Render ohne Plugin-Setup, oder Vitest ohne vi.mock). In Production
 * ist der ToastService per Nuxt-Plugin global verfuegbar; im Test wird
 * das `primevue/usetoast`-Modul per vi.mock ersetzt.
 */
const noopToast = {
  add: () => {},
  removeGroup: () => {},
}

export function useUndoableDelete<TItem extends { id: string; kind?: UndoableDeleteKind }>(
  options: UndoableDeleteOptions<TItem>,
) {
  // PrimeVue's useToast benutzt `inject()` mit einem Symbol — das wirft
  // ohne `provide()`-Setup eine Exception ("No PrimeVue Toast provided!").
  //
  // Drei Kontexte, in denen der Toast fehlen kann:
  //  1. SSR-Render: Plugin ist `.client.ts`, laeuft nicht auf dem Server.
  //     `useToast()` wuerde die ganze Page-Setup-Phase crashen.
  //  2. Vitest ohne vi.mock: gleicher Fehler.
  //  3. Production-Browser mit Plugin: alles gut, useToast liefert Service.
  //
  // Loesung: try/catch um den useToast-Aufruf, Fallback auf noopToast.
  // Im SSR-Path wird der Toast ohnehin nie gerendert (Toast-Component
  // ist auch client-only) — also ist der noopFallback dort semantisch
  // korrekt, nicht nur pragmatisch.
  let toast: { add: (msg: unknown) => void; removeGroup: (group: string) => void } = noopToast
  try {
    toast = useToast() as unknown as typeof toast
  } catch {
    // useToast nicht verfuegbar — Fallback beibehalten.
  }
  const undoWindow = options.undoWindowMs ?? UNDO_WINDOW_DEFAULT

  // Map<itemId, PendingUndo> — keyed by ID fuer schnellen Lookup
  // bei Undo / Page-Leave. Mehrere gleichzeitige Undos sind moeglich
  // (z. B. Bulk-Delete in einem spaeteren Issue), jeder hat seinen
  // eigenen Timer.
  const pending = ref<Map<string, PendingUndo<TItem>>>(new Map())

  function buildDeleteUrl(id: string): string {
    const hh = options.householdId()
    if (!hh) throw new Error('householdId missing')
    return options.kind === 'expense'
      ? `/api/households/${hh}/expenses/${id}`
      : `/api/households/${hh}/incomes/${id}`
  }

  function buildRestoreUrl(id: string): string {
    const hh = options.householdId()
    if (!hh) throw new Error('householdId missing')
    return options.kind === 'expense'
      ? `/api/households/${hh}/expenses/${id}/restore`
      : `/api/households/${hh}/incomes/${id}/restore`
  }

  function labelForKind(): string {
    return options.kind === 'expense' ? 'Ausgabe' : 'Einnahme'
  }

  function itemLabel(item: TItem): string {
    // Wenn das Item einen description-Feld hat, nimm den; sonst generisch.
    const anyItem = item as unknown as { description?: string | null }
    return anyItem.description?.trim() || labelForKind()
  }

  function clearTimer(id: string) {
    const entry = pending.value.get(id)
    if (entry) {
      clearTimeout(entry.timerId)
    }
  }

  function dismissPending(id: string) {
    clearTimer(id)
    pending.value.delete(id)
    // Trigger reactivity (Map mutations allein loesen kein Ref-Trigger aus)
    pending.value = new Map(pending.value)
  }

  /**
   * Loescht ein Item mit Undo-Banner. Server-Call + optimistic Remove
   * + 5-Sekunden-Timer. Bei Server-Fehler: Rollback + Error-Toast.
   */
  async function deleteWithUndo(item: TItem): Promise<void> {
    const hh = options.householdId()
    if (!hh) return

    // Snapshot fuer Rollback: wir brauchen die Position + den vollstaendigen
    // Datensatz. Da der Caller die Liste selbst verwaltet, kuemmern wir uns
    // um den Rollback ueber onRestoreLocal mit dem Original-Item.
    const original = item
    options.onRemoveLocal(item.id)

    try {
      await $fetch(buildDeleteUrl(item.id), { method: 'DELETE' })
    } catch (error: any) {
      // Server-Fehler: Zeile wieder einblenden, Error-Toast, kein Undo-Banner.
      options.onRestoreLocal(original)
      toast.add({
        severity: 'error',
        summary: 'Loeschen fehlgeschlagen',
        detail: error?.statusMessage || error?.message || 'Unbekannter Fehler',
        life: 4000,
      })
      return
    }

    // 5-Sekunden-Timer: danach verschwindet der Banner, kein Hard-Delete.
    const timerId = setTimeout(() => {
      dismissPending(item.id)
    }, undoWindow)

    pending.value.set(item.id, {
      item,
      kind: options.kind,
      timerId,
      removedSnapshot: null,
    })
    pending.value = new Map(pending.value)

    toast.add({
      severity: 'info',
      summary: `${labelForKind()} geloescht`,
      detail: `"${itemLabel(item)}" — Rueckgaengig moeglich fuer ${Math.round(undoWindow / 1000)} Sek.`,
      life: undoWindow,
      group: `undo-${item.id}`,
    })
  }

  /**
   * Macht den letzten (oder einen bestimmten) Loeschvorgang rueckgaengig.
   * Server-Call POST /restore, bei Erfolg Item wieder in die Liste.
   * Bei Fehler: Error-Toast, Item bleibt aus der Liste (es ist ja
   * serverseitig als deleted markiert).
   */
  async function undo(id: string): Promise<void> {
    const entry = pending.value.get(id)
    if (!entry) return

    // Snapshot fuer eventuellen Rollback: das Original-Item
    // koennen wir wieder herstellen, falls der Server-Call fehlschlaegt
    // und das Item noch im Local-State des Composables haengt.
    const restoredItem = entry.item

    // Timer clearen, Eintrag aus pending entfernen
    dismissPending(id)

    try {
      const response = await $fetch<{ data: { kind: string; restored: boolean; alreadyActive?: boolean } }>(
        buildRestoreUrl(id),
        { method: 'POST' },
      )
      // Erfolg: Item wieder in die lokale Liste einfuegen.
      options.onRestoreLocal(restoredItem)
      options.onAfterChange?.()

      // Bestätigungs-Toast, separater Lifecycle vom Undo-Banner.
      toast.add({
        severity: 'success',
        summary: 'Wiederhergestellt',
        detail: `"${itemLabel(restoredItem)}" ist wieder in der Liste.`,
        life: 3000,
      })

      // Falls der Undo-Banner noch sichtbar war (Toast-Lifecycle),
      // entfernen wir die zugehoerige Toast-Gruppe explizit.
      // PrimeVue 4 hat dafuer `toast.removeGroup()`.
      // (Best effort — wenn der Banner schon weg ist, ist das ein no-op.)
      try {
        toast.removeGroup(`undo-${id}`)
      } catch {
        // no-op
      }

      // response ist aktuell ungenutzt ausser fuer Fehler-Logging
      void response
    } catch (error: any) {
      // Restore fehlgeschlagen — komisch, weil das Item serverseitig
      // deleted ist. Wir wissen nicht, ob der Server das Item wirklich
      // wiederhergestellt hat. Sicherheits-Toast, damit der User weiss,
      // dass was schief gelaufen ist.
      toast.add({
        severity: 'error',
        summary: 'Wiederherstellen fehlgeschlagen',
        detail: error?.statusMessage || error?.message || 'Unbekannter Fehler — bitte Seite neu laden.',
        life: 5000,
      })
    }
  }

  /**
   * Wird aufgerufen, wenn der User den Undo-Banner schliesst oder die
   * Page verlaesst, ohne Undo zu klicken. Kein server-Call noetig
   * (Variante A, soft-permanent).
   */
  function dismiss(id: string): void {
    dismissPending(id)
    try {
      toast.removeGroup(`undo-${id}`)
    } catch {
      // no-op
    }
  }

  // Cleanup: alle offenen Timer bei Page-Leave abbrechen, sonst
  // laufen sie ins Leere und produzieren Memory-Leaks / stale renders.
  onBeforeUnmount(() => {
    for (const entry of pending.value.values()) {
      clearTimeout(entry.timerId)
    }
    pending.value.clear()
  })

  return {
    pending,
    deleteWithUndo,
    undo,
    dismiss,
  }
}
