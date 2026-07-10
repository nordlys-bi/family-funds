<!--
  ConfirmSheetRoot — globaler Mount-Point fuer useAskConfirm (issue #51).

  Wird EINMAL in `app/app.vue` (oder im default-Layout) eingebunden.
  Rendert NUR, wenn `useAskConfirm().pending` gesetzt ist, und uebergibt
  den pending-Request an die bestehende <ConfirmSheet />-Komponente.

  Architektur: useAskConfirm haelt den State, <ConfirmSheet> ist nur
  presentational. Diese Root-Komponente ist die Bruecke dazwischen —
  das eigentliche Modal-Verhalten (Esc, Mask-Tap, Teleport) liegt
  in <ConfirmSheet> bzw. dessen <BottomSheet>-Wrapper.

  Naming: NICHT <ConfirmDialog> — PrimeVue 4 hat eine eigene
  `ConfirmDialog`-Component (in `primevue/confirmdialog`,
  ConfirmationService-Pattern, braucht Provide-Setup). Der
  PrimeVueResolver resolvet `<ConfirmDialog>` zuerst zu PrimeVue's
  Version, was zu `Cannot read properties of null (reading 'icon')`
  crashed, weil `ConfirmationService` in unserer App nicht
  installiert ist. `ConfirmSheet` ist eindeutig und beschreibt die
  Architektur (es IST ein BottomSheet-Wrapper).

  Globale Instance ist okay, weil useAskConfirm per useState nur einen
  offenen Pending-Dialog gleichzeitig erlaubt.
-->

<script setup lang="ts">
import { computed } from 'vue'

const { pending, confirm, cancel } = useAskConfirm()

const visible = computed(() => pending.value !== null)
const request = computed(() => pending.value?.request)
</script>

<template>
  <ConfirmSheet
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
