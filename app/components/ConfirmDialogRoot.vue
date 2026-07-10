<!--
  ConfirmDialogRoot — globaler Mount-Point fuer useConfirm (issue #51).

  Wird EINMAL in `app/app.vue` (oder im default-Layout) eingebunden.
  Rendert NUR, wenn `useConfirm().pending` gesetzt ist, und uebergibt
  den pending-Request an die bestehende <ConfirmDialog />-Komponente.

  Architektur: useConfirm haelt den State, <ConfirmDialog> ist nur
  presentational. Diese Root-Komponente ist die Bruecke dazwischen —
  das eigentliche Modal-Verhalten (Esc, Mask-Tap, Teleport) liegt
  in <ConfirmDialog> bzw. dessen <BottomSheet>-Wrapper.

  Globale Instance ist okay, weil useConfirm per useState nur einen
  offenen Pending-Dialog gleichzeitig erlaubt.
-->

<script setup lang="ts">
import { computed } from 'vue'

const { pending, confirm, cancel } = useConfirm()

const visible = computed(() => pending.value !== null)
const request = computed(() => pending.value?.request)
</script>

<template>
  <ConfirmDialog
    v-if="request"
    :visible="visible"
    :title="request.title"
    :message="request.message"
    :tone="request.tone"
    :confirm-label="request.confirmLabel"
    :cancel-label="request.cancelLabel"
    @confirm="confirm"
    @cancel="cancel"
  />
</template>
