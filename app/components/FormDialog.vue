<!--
  FormDialog — Wrapper um PrimeVue Dialog fuer Create/Edit-Formulare.

  Verwendung:
  <FormDialog
    v-model:visible="dialogOpen"
    :header="editId ? 'Eintrag bearbeiten' : 'Eintrag anlegen'"
    @save="save"
    :saving="saving"
  >
    <FormField label="Name" html-for="my-name">
      <InputText id="my-name" v-model="form.name" />
    </FormField>
    <FormField label="Betrag" html-for="my-amount">
      <InputNumber id="my-amount" v-model="form.amount" />
    </FormField>
  </FormDialog>
-->
<script setup lang="ts">
defineProps<{
  /** Two-way binding fuer Sichtbarkeit. */
  visible: boolean
  /** Header-Titel des Dialogs. */
  header: string
  /** Submit-Button-Label. Default 'Speichern'. */
  submitLabel?: string
  /** Cancel-Button-Label. Default 'Abbrechen'. */
  cancelLabel?: string
  /** Lade-Status, der den Submit-Button deaktiviert. */
  saving?: boolean
  /** Maximale Breite via CSS. Default 'min(42rem, 94vw)'. */
  width?: string
  /** Klick auf die Maske schliesst den Dialog. */
  dismissableMask?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: []
  cancel: []
}>()

function updateVisible(value: boolean) {
  emit('update:visible', value)
}

function handleHide() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="header"
    :style="{ width: width ?? 'min(42rem, 94vw)' }"
    :dismissableMask="dismissableMask ?? true"
    @update:visible="updateVisible"
    @hide="handleHide"
  >
    <form class="form-dialog" @submit.prevent="emit('save')">
      <slot />

      <div class="form-dialog__actions">
        <Button
          type="button"
          :label="cancelLabel ?? 'Abbrechen'"
          severity="secondary"
          outlined
          @click="emit('cancel')"
        />
        <Button
          type="submit"
          :label="submitLabel ?? 'Speichern'"
          icon="pi pi-check"
          :loading="saving ?? false"
        />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.form-dialog {
  display: grid;
  gap: 0.95rem;
}

.form-dialog__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.25rem;
}

@media (max-width: 720px) {
  .form-dialog__actions {
    grid-template-columns: 1fr;
  }
}
</style>