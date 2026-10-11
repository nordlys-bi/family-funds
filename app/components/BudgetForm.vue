<!--
  BudgetForm — Sub-Form für periodische Budgets.

  Verwendung:
  <BudgetForm
    v-model="budgetForm"
    :currency="currencyCode"
  />

  Felder:
  - name (string)
  - amount (number | null, EUR)
  - frequency (Frequency)
  - validFrom (Date)

  `frequencyLocked` (ADR-0004): Beim Bearbeiten ist die Frequenz fest — eine
  andere Periodizitaet heisst neues Budget anlegen und das alte schliessen.

  Eine Zeile weniger als RecurringPlanForm: Budgets haben kein Enddatum,
  dafür muss `validFrom` reaktiv an die Frequency angepasst werden, wenn ein
  neuer Budget angelegt wird (im Page-Watcher, der das Formular umgibt).
-->
<script setup lang="ts">
import type { Frequency } from '~/types/planning'

export type BudgetFormData = {
  name: string
  amount: number | null
  frequency: Frequency
  validFrom: Date
}

const props = defineProps<{
  modelValue: BudgetFormData
  currency: string
  frequencyLocked?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BudgetFormData]
}>()

function patch<K extends keyof BudgetFormData>(
  key: K,
  value: BudgetFormData[K],
) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <FormFieldRow label="Name" htmlFor="budget-name" wide>
    <InputText
      id="budget-name"
      :modelValue="modelValue.name"
      @update:modelValue="(v) => patch('name', v ?? '')"
      placeholder="z. B. Lebensmittel"
    />
  </FormFieldRow>
  <FormFieldRow label="Betrag" htmlFor="budget-amount">
    <MoneyInput
      id="budget-amount"
      :modelValue="modelValue.amount"
      @update:modelValue="(v) => patch('amount', v)"
      :currency="currency"
    />
  </FormFieldRow>
  <FormFieldRow label="Frequenz" htmlFor="budget-frequency">
    <Select
      id="budget-frequency"
      :modelValue="modelValue.frequency"
      @update:modelValue="(v) => patch('frequency', v ?? 'MONTHLY')"
      :options="frequencySelectOptions()"
      optionLabel="label"
      optionValue="value"
      :disabled="frequencyLocked"
    />
    <small v-if="frequencyLocked" class="budget-form__hint">
      Frequenz ist fest. Für eine andere Frequenz ein neues Budget anlegen und dieses hinein schließen.
    </small>
  </FormFieldRow>
  <FormFieldRow label="Gültig ab" htmlFor="budget-valid-from">
    <DatePicker
      id="budget-valid-from"
      :modelValue="modelValue.validFrom"
      @update:modelValue="(v) => patch('validFrom', v ?? new Date())"
      showIcon
      dateFormat="dd.mm.yy"
    />
  </FormFieldRow>
</template>

<style scoped>
.budget-form__hint {
  display: block;
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}
</style>
