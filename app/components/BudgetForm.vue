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
    />
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
