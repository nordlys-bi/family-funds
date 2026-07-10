<!--
  FabSpeedDial — Mobile-only Floating Action Button mit Speed-Dial Submenü.

  Verwendung:
  <FabSpeedDial
    :actions="[
      { key: 'expense', label: 'Ausgabe', icon: 'pi pi-arrow-up-right', tone: 'danger', onSelect: openExpense },
      { key: 'income',  label: 'Einnahme', icon: 'pi pi-arrow-down-left', tone: 'success', onSelect: openIncome },
      { key: 'savings', label: 'Sparziel', icon: 'pi pi-star', tone: 'accent', onSelect: openSavings },
    ]"
  />

  Verhalten:
  - Sichtbar nur auf Mobile (< 640px). Im `default.vue`-Layout platzieren, nicht in Pages.
  - Tap auf Haupt-FAB öffnet 3 Mini-FABs in einer vertikalen Spalte darüber.
  - Animation: Haupt-Icon rotiert 45° beim Öffnen, Mini-FABs erscheinen mit
    50ms Stagger per Scale + Translate.
  - Tap outside oder ESC schließt wieder.
  - Safe-Area-Insets für iPhone-Notch / Home-Indicator.

  Props:
  - actions:    Liste der Aktionen (Reihenfolge unten-nach-oben).
                onSelect wird aufgerufen, der Dialog kümmert sich selbst ums Öffnen.
  - defaultOpen: initialer Open-State (default false).

  Events:
  - select:     Tastenauswahl weitergeben (fürs Tracking).
  - update:open: zwei-Wege-Bindung, falls der Parent den State steuern will.
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type FabSpeedDialAction = {
  /** Eindeutiger Key fürs Tracking/Tests. */
  key: string
  /** Label im Pill links neben dem Mini-FAB. */
  label: string
  /** PrimeVue-Icon, z. B. 'pi pi-arrow-up-right'. */
  icon: string
  /** Optische Akzent-Farbe: danger (rot), success (grün), accent (blau). */
  tone: 'danger' | 'success' | 'accent'
  /** Wird beim Auswählen der Aktion aufgerufen. */
  onSelect: () => void
}

const props = withDefaults(
  defineProps<{
    actions: FabSpeedDialAction[]
    defaultOpen?: boolean
  }>(),
  { defaultOpen: false },
)

const emit = defineEmits<{
  select: [key: string]
  'update:open': [value: boolean]
}>()

const isOpen = ref(props.defaultOpen)

watch(isOpen, (value) => emit('update:open', value))

function toggle() {
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function selectAction(action: FabSpeedDialAction) {
  emit('select', action.key)
  action.onSelect()
  close()
}

const containerRef = ref<HTMLElement | null>(null)

function onDocumentPointer(event: PointerEvent) {
  if (!isOpen.value) return
  const container = containerRef.value
  if (!container) return
  if (event.target instanceof Node && container.contains(event.target)) return
  close()
}

function onDocumentKey(event: KeyboardEvent) {
  if (!isOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
  document.addEventListener('keydown', onDocumentKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer)
  document.removeEventListener('keydown', onDocumentKey)
})
</script>

<template>
  <div
    ref="containerRef"
    class="fab-speed-dial"
    :class="{ 'fab-speed-dial--open': isOpen }"
    role="group"
    aria-label="Schnellaktionen"
  >
    <div class="fab-speed-dial__items">
      <button
        v-for="(action, index) in actions"
        :key="action.key"
        type="button"
        class="fab-mini"
        :class="[`fab-mini--${action.tone}`]"
        :style="{ transitionDelay: isOpen ? `${index * 50}ms` : '0ms' }"
        :tabindex="isOpen ? 0 : -1"
        :aria-hidden="!isOpen"
        :aria-label="action.label"
        @click="selectAction(action)"
      >
        <span class="fab-mini__label">{{ action.label }}</span>
        <span class="fab-mini__icon" aria-hidden="true">
          <i :class="action.icon" />
        </span>
      </button>
    </div>

    <button
      type="button"
      class="fab-main"
      :aria-expanded="isOpen"
      :aria-label="isOpen ? 'Aktionen schließen' : 'Schnellaktionen öffnen'"
      @click="toggle"
    >
      <i class="pi pi-plus fab-main__icon" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.fab-speed-dial {
  /* Position: rechts unten, ABER oberhalb der Mobile-Bottom-Nav (issue #31).
     Die Bottom-Nav belegt unten ca. 56px (min-height) + 20px Padding +
     1px Border + safe-area-inset-bottom = ~5rem + safe-area. Wir setzen
     den FAB auf 5.5rem + safe-area, das gibt ~11px Atemraum auf
     Geraeten ohne Safe-Area und ~6px auf iPhones mit Home-Indicator.
     Wenn die Bottom-Nav-Hoehe sich mal aendert, muss dieser Wert
     nachjustiert werden — die zentrale Konstante waere eine CSS-Variable. */
  position: fixed;
  right: calc(1.25rem + env(safe-area-inset-right, 0px));
  bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
  z-index: 1200;

  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

/* FAB ist Mobile-only. Auf Desktop übernimmt der Split-Button im Toolbar. */
@media (min-width: 640px) {
  .fab-speed-dial {
    display: none;
  }
}

.fab-main {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 0;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 14px 30px rgba(59, 130, 246, 0.35);
  cursor: pointer;
  transition:
    box-shadow 0.18s ease,
    transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.fab-main:hover {
  box-shadow: 0 16px 36px rgba(59, 130, 246, 0.45);
}

.fab-main:active {
  transform: scale(0.96);
}

.fab-main__icon {
  font-size: 1.4rem;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.fab-speed-dial--open .fab-main__icon {
  transform: rotate(45deg);
}

/* Mini-FABs: Column oberhalb des Haupt-FAB, Label links vom Icon. */
.fab-speed-dial__items {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.fab-mini {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  opacity: 0;
  transform: scale(0.4) translateY(8px);
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.fab-speed-dial--open .fab-mini {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.fab-mini__label {
  background: rgba(15, 23, 42, 0.94);
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.2);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(2, 6, 23, 0.4);
}

.fab-mini__icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.05rem;
  box-shadow: 0 8px 22px rgba(2, 6, 23, 0.36);
}

.fab-mini--danger  .fab-mini__icon { background: linear-gradient(135deg, #ef4444, #f87171); }
.fab-mini--success .fab-mini__icon { background: linear-gradient(135deg, #10b981, #34d399); }
.fab-mini--accent  .fab-mini__icon { background: linear-gradient(135deg, #3b82f6, #60a5fa); }
</style>
