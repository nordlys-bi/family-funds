<!--
  FormField — kapselt ein PrimeVue-Form-Element mit Label.

  Verwendung:
  <FormField label="Name" html-for="budget-name">
    <InputText id="budget-name" v-model="form.name" />
  </FormField>

  Optional mit `wide` fuer Felder, die die volle Grid-Spannweite einnehmen.
-->
<script setup lang="ts">
defineProps<{
  /** Label-Text. */
  label: string
  /** ID des Form-Elements fuer html-for. */
  htmlFor: string
  /** Volle Breite im Grid-Layout. */
  wide?: boolean
}>()
</script>

<template>
  <div class="form-field" :class="{ 'form-field--wide': wide }">
    <label :for="htmlFor" class="form-field__label">{{ label }}</label>
    <slot />
  </div>
</template>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.form-field__label {
  font-size: 0.84rem;
  font-weight: 700;
  color: #e2e8f0;
}

:deep(.p-inputtext),
:deep(.p-select),
:deep(.p-datepicker),
:deep(.p-inputnumber) {
  width: 100%;
}

:deep(.p-select-label),
:deep(.p-inputnumber-input) {
  color: inherit;
}

:deep(.p-button) {
  border-radius: 14px;
}
</style>