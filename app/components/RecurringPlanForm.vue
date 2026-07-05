<!--
  RecurringPlanForm — Sub-Form für Income- und Fixed-Cost-Pläne.

  Verwendung:
  <RecurringPlanForm
    v-model="incomeForm"
    id-prefix="income"
    :currency="currencyCode"
    name-placeholder="z. B. Gehalt"
  />

  Felder:
  - name (string)
  - amount (number | null, EUR)
  - frequency (Frequency)
  - startDate (Date | null)
  - endDate (Date | null)

  Begründung: Income- und Fixed-Cost-Dialog in `pages/budgeting/recurring.vue`
  waren 1:1 identisch (mit unterschiedlichen id-Prefixen und Placeholdern).
-->
<script setup lang="ts">
import type { Frequency } from '~/types/planning'

export type RecurringPlanFormData = {
  name: string
  amount: number | null
  frequency: Frequency
  startDate: Date | null
  endDate: Date | null
}

const props = defineProps<{
  modelValue: RecurringPlanFormData
  /** Prefix für input-IDs (z. B. 'income' / 'fixed'). */
  idPrefix: string
  /** ISO-Currency-Code (EUR/USD). */
  currency: string
  /** Placeholder für das Name-Feld. */
  namePlaceholder: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: RecurringPlanFormData]
}>()

function update<K extends keyof RecurringPlanFormData>(
  key: K,
  value: RecurringPlanFormData[K],
) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <FormFieldRow label="Name" :htmlFor="`${idPrefix}-name`" wide>
    <InputText
      :id="`${idPrefix}-name`"
      :modelValue="modelValue.name"
      @update:modelValue="(v) => update('name', v ?? '')"
      :placeholder="namePlaceholder"
    />
  </FormFieldRow>
  <FormFieldRow label="Betrag" :htmlFor="`${idPrefix}-amount`">
    <MoneyInput
      :id="`${idPrefix}-amount`"
      :modelValue="modelValue.amount"
      @update:modelValue="(v) => update('amount', v)"
      :currency="currency"
    />
  </FormFieldRow>
  <FormFieldRow label="Frequenz" :htmlFor="`${idPrefix}-frequency`">
    <Select
      :id="`${idPrefix}-frequency`"
      :modelValue="modelValue.frequency"
      @update:modelValue="(v) => update('frequency', v ?? 'MONTHLY')"
      :options="frequencySelectOptions()"
      optionLabel="label"
      optionValue="value"
    />
  </FormFieldRow>
  <FormFieldRow label="Start" :htmlFor="`${idPrefix}-start`">
    <DatePicker
      :id="`${idPrefix}-start`"
      :modelValue="modelValue.startDate"
      @update:modelValue="(v) => update('startDate', v)"
      showIcon
      dateFormat="dd.mm.yy"
    />
  </FormFieldRow>
  <FormFieldRow label="Ende" :htmlFor="`${idPrefix}-end`">
    <DatePicker
      :id="`${idPrefix}-end`"
      :modelValue="modelValue.endDate"
      @update:modelValue="(v) => update('endDate', v)"
      showIcon
      dateFormat="dd.mm.yy"
    />
  </FormFieldRow>
</template>
