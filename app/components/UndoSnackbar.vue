<!--
  UndoSnackbar — Bestätigungs-Banner nach Soft-Delete (issue #58).

  Wird von expenses.vue / income.vue aus dem `pending`-State des
  useUndoableDelete-Composables gerendert. Zeigt die geloeschte Buchung
  + "Rueckgaengig"-Button + "X"-Dismiss. Verschwindet automatisch nach
  Ablauf des Undo-Fensters (Timer laeuft im Composable).

  Layout:
    - Mobile: Vollbreite mit Seiten-Padding, ueber der Bottom-Nav
    - Desktop: Zentriert, max-width 480px, am unteren Rand
    - Fixed positioning, Teleport zu body wegen Stacking-Context
    - z-index 1050: ueber normalem Content, unter BottomSheet (1100)

  Accessibility:
    - role="status" + aria-live="polite" -> Screenreader liest es vor,
      ohne Fokus zu klauen
    - Undo-Button ist fokussierbar, ESC-Taste schliesst den Banner
      (Tastatur-User koennen ihn ohne Maus schliessen)

  Hinweis zu PrimeVue-Icons: UndoIcon ist im @primevue/icons-Paket
  verfuegbar (siehe PrimeVue 4 Icon-Paket-Liste in Memory). times-Icon
  ist im PrimeIcons-CSS als `pi pi-times` verfuegbar (nicht in
  @primevue/icons, aber in primeicons.css).
-->

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import UndoIcon from '@primevue/icons/undo'

type UndoSnackbarProps = {
  /** Id des geloeschten Items, fuer den undo/dismiss-Handler. */
  itemId: string
  /** Was wurde geloescht? 'Ausgabe' oder 'Einnahme'. */
  kindLabel: 'Ausgabe' | 'Einnahme'
  /** Optionale Beschreibung des Items (z.B. "Rewe Einkauf"). */
  itemDescription?: string | null
  /** Wie viele Sekunden das Undo-Fenster noch laeuft (fuer Countdown-Text). */
  remainingSeconds: number
}

const props = defineProps<UndoSnackbarProps>()

const emit = defineEmits<{
  (e: 'undo', itemId: string): void
  (e: 'dismiss', itemId: string): void
}>()

const ariaMessage = computed(
  () => `${props.kindLabel} geloescht${props.itemDescription ? `: ${props.itemDescription}` : ''}. Rueckgaengig moeglich fuer ${props.remainingSeconds} Sekunden.`,
)

function onUndo() {
  emit('undo', props.itemId)
}

function onDismiss() {
  emit('dismiss', props.itemId)
}

function onKeydown(event: KeyboardEvent) {
  // ESC schliesst den Banner (ohne Undo). Hat Vorrang vor globalen
  // ESC-Handlern der Page, weil der Banner im Vordergrund ist.
  if (event.key === 'Escape') {
    event.preventDefault()
    onDismiss()
  }
}

onMounted(() => {
  if (import.meta.client) {
    document.addEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="undo-snackbar" role="status" aria-live="polite" :aria-label="ariaMessage">
      <div class="undo-snackbar__inner">
        <div class="undo-snackbar__icon" aria-hidden="true">
          <UndoIcon />
        </div>

        <div class="undo-snackbar__content">
          <p class="undo-snackbar__title">
            {{ kindLabel }} geloescht<span v-if="itemDescription">: &bdquo;{{ itemDescription }}&ldquo;</span>
          </p>
          <p class="undo-snackbar__hint">
            Rueckgaengig moeglich fuer {{ remainingSeconds }} Sek.
          </p>
        </div>

        <div class="undo-snackbar__actions">
          <button
            type="button"
            class="undo-snackbar__undo"
            data-testid="undo-snackbar-undo"
            @click="onUndo"
          >
            Rueckgaengig
          </button>

          <button
            type="button"
            class="undo-snackbar__dismiss"
            data-testid="undo-snackbar-dismiss"
            aria-label="Bestaetigen und Banner schliessen"
            @click="onDismiss"
          >
            <i class="pi pi-times" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.undo-snackbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 1.25rem;
  z-index: 1050;
  display: flex;
  justify-content: center;
  pointer-events: none;
  padding: 0 1rem;
}

.undo-snackbar__inner {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  width: 100%;
  max-width: 480px;
  background: var(--color-bg-modal);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(2, 6, 23, 0.55);
  padding: 0.75rem 0.875rem;
}

/* Icon-Container (rund, dezent) */
.undo-snackbar__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-text);
}

.undo-snackbar__icon :deep(svg) {
  width: 1.1rem;
  height: 1.1rem;
}

/* Content: zwei Zeilen Text */
.undo-snackbar__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.undo-snackbar__title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.undo-snackbar__hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  line-height: 1.3;
}

/* Action-Container: Undo + Dismiss */
.undo-snackbar__actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
}

.undo-snackbar__undo {
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--color-accent-primary);
  color: var(--color-text-on-action);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
}

.undo-snackbar__undo:hover {
  background: var(--color-accent-primary-hover);
}

.undo-snackbar__undo:active {
  transform: scale(0.98);
}

.undo-snackbar__undo:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.undo-snackbar__dismiss {
  font: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.undo-snackbar__dismiss:hover {
  background: rgba(148, 163, 184, 0.12);
  color: var(--color-text-primary);
}

.undo-snackbar__dismiss:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.undo-snackbar__dismiss :deep(i) {
  font-size: 0.95rem;
  line-height: 1;
}

/* Mobile-Anpassung: hoeher setzen, ueber der Bottom-Nav (falls vorhanden),
   kleiner Innenabstand. Die Mobile-Bottom-Nav hat ~64px Hoehe + Safe-Area. */
@media (max-width: 767px) {
  .undo-snackbar {
    bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 1rem);
  }

  .undo-snackbar__title {
    font-size: 0.85rem;
  }

  .undo-snackbar__hint {
    font-size: 0.75rem;
  }

  .undo-snackbar__undo {
    padding: 0.4rem 0.7rem;
    font-size: 0.8rem;
  }
}
</style>
