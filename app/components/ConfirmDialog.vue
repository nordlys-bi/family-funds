<!--
  ConfirmDialog — Bestätigungsdialog als BottomSheet-Wrapper.

  Verwendung:
  <ConfirmDialog
    v-model:visible="confirmOpen"
    title="Mitglied entfernen?"
    message="Anna darf dann nicht mehr auf den Haushalt zugreifen."
    tone="danger"
    confirm-label="Entfernen"
    @confirm="handleRemove"
    @cancel="handleCancel"
  />

  Verhalten:
  - v-model:visible für open/close.
  - Esc, Tap auf Maske, Abbrechen-Button: schließt (emits cancel).
  - Bestätigen: emits confirm und schließt.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    /** Visueller Ton für den Confirm-Button. */
    tone?: 'danger' | 'primary'
    saving?: boolean
  }>(),
  {
    confirmLabel: 'Bestätigen',
    cancelLabel: 'Abbrechen',
    tone: 'primary',
    saving: false,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
  cancel: []
}>()

const isVisible = ref(props.visible)

watch(
  () => props.visible,
  (value) => {
    isVisible.value = value
  },
)

watch(isVisible, (value) => {
  emit('update:visible', value)
})

function close() {
  isVisible.value = false
}

function onCancel() {
  emit('cancel')
  close()
}

function onConfirm() {
  emit('confirm')
}
</script>

<template>
  <BottomSheet
    v-model:visible="isVisible"
    :title="title"
    @close="emit('cancel')"
  >
    <p v-if="message" class="confirm-dialog__message">{{ message }}</p>
    <slot />

    <template #footer>
      <Button
        type="button"
        :label="cancelLabel"
        severity="secondary"
        outlined
        @click="onCancel"
      />
      <Button
        type="button"
        :label="confirmLabel"
        :severity="tone === 'danger' ? 'danger' : undefined"
        :loading="saving"
        @click="onConfirm"
      />
    </template>
  </BottomSheet>
</template>

<style scoped>
.confirm-dialog__message {
  margin: 0 0 1rem;
  color: var(--color-text-secondary);
  line-height: 1.55;
}
</style>
