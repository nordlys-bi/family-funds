<!--
  BottomSheet — Dialog-Wrapper mit Mobile-First Verhalten.

  Auf Mobile (< 640px): Full-Width-Bottom-Sheet, sticky Header + Footer,
  Scroll-Container dazwischen. Tastatur verdeckt den Save-Button nicht.

  Auf Desktop: klassischer zentrierter Modal mit gleicher Slot-Struktur.

  Verwendung:
  <BottomSheet v-model:visible="dialogOpen" title="Ausgabe erfassen">
    <FormField label="Betrag" htmlFor="amount">
      <InputNumber v-model="form.amount" />
    </FormField>
    <template #footer>
      <Button label="Abbrechen" severity="secondary" outlined @click="close" />
      <Button label="Speichern" icon="pi pi-check" @click="save" />
    </template>
  </BottomSheet>

  Verhalten:
  - Esc, Tap auf Maske, Schließen-Button: schließt.
  - Body-Scroll wird beim Öffnen gelockt.
  - Safe-Area-Insets für iPhone-Notch.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    /** Maximale Breite auf Desktop, default 32rem. */
    maxWidth?: string
    /** Disable mask-click schließen. */
    dismissableMask?: boolean
  }>(),
  {
    maxWidth: '32rem',
    dismissableMask: true,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

// Mobile-Detection via matchMedia, reagiert auf Resize
const isMobile = ref(false)
let mediaQuery: MediaQueryList | null = null

function syncMobile(event: MediaQueryListEvent | MediaQueryList) {
  isMobile.value = event.matches
}

function close() {
  emit('update:visible', false)
  emit('close')
}

function onMaskClick() {
  if (props.dismissableMask) close()
}

function onKeyDown(event: KeyboardEvent) {
  if (!props.visible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

// Body-Scroll lock nur auf Mobile (auf Desktop Scroll okay).
watch(
  () => props.visible,
  (open) => {
    if (!import.meta.client) return
    if (!isMobile.value) return
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onMounted(() => {
  if (import.meta.client) {
    mediaQuery = window.matchMedia('(max-width: 639px)')
    syncMobile(mediaQuery)
    mediaQuery.addEventListener('change', syncMobile)
    document.addEventListener('keydown', onKeyDown)
  }
})

onBeforeUnmount(() => {
  if (import.meta.client) {
    mediaQuery?.removeEventListener('change', syncMobile)
    document.removeEventListener('keydown', onKeyDown)
    document.body.style.overflow = ''
  }
})

const containerStyle = computed(() =>
  isMobile.value ? undefined : { maxWidth: props.maxWidth },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div
        v-if="visible"
        class="bottom-sheet-mask"
        role="presentation"
        @click.self="onMaskClick"
      >
        <div
          class="bottom-sheet"
          :class="{ 'bottom-sheet--mobile': isMobile }"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="containerStyle"
        >
          <header class="bottom-sheet__header">
            <h2 class="bottom-sheet__title">{{ title }}</h2>
            <button
              type="button"
              class="bottom-sheet__close"
              aria-label="Schließen"
              @click="close"
            >
              <i class="pi pi-times" aria-hidden="true" />
            </button>
          </header>

          <div class="bottom-sheet__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="bottom-sheet__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Mask — full-screen overlay */
.bottom-sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

/* Desktop: zentrierter Modal, Standard-Radius */
.bottom-sheet {
  background: var(--color-bg-modal);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 18px;
  box-shadow: 0 30px 80px rgba(2, 6, 23, 0.6);
  display: flex;
  flex-direction: column;
  max-height: min(90vh, 720px);
  width: 100%;
  overflow: hidden;
}

.bottom-sheet__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.5rem;
  background: var(--color-bg-modal);
  border-bottom: 1px solid var(--color-border-subtle);
}

.bottom-sheet__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.bottom-sheet__close {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.bottom-sheet__close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.bottom-sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
  /* Eigener Scroll-Container zwischen sticky Header und Footer */
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.bottom-sheet__footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  flex-wrap: wrap;
  padding: 1rem 1.5rem;
  background: var(--color-bg-modal);
  border-top: 1px solid var(--color-border-subtle);
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
}

/* Mobile: Bottom-Sheet, full-width und full-height (mit Safe-Area) */
.bottom-sheet--mobile {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 92vh;
  max-height: calc(92dvh + env(safe-area-inset-bottom, 0px));
  border-radius: 18px 18px 0 0;
  width: 100%;
}

/* Transition */
.bottom-sheet-enter-active,
.bottom-sheet-leave-active {
  transition: opacity 0.18s ease;
}

.bottom-sheet-enter-active .bottom-sheet,
.bottom-sheet-leave-active .bottom-sheet {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.bottom-sheet-enter-from,
.bottom-sheet-leave-to {
  opacity: 0;
}

.bottom-sheet-enter-from .bottom-sheet,
.bottom-sheet-leave-to .bottom-sheet {
  transform: translateY(100%);
}

@media (min-width: 640px) {
  .bottom-sheet-enter-from .bottom-sheet,
  .bottom-sheet-leave-to .bottom-sheet {
    transform: translateY(8px) scale(0.98);
  }
}

/* Mobile: full-screen Mask ohne Padding */
@media (max-width: 639px) {
  .bottom-sheet-mask {
    padding: 0;
    align-items: flex-end;
  }
}
</style>
