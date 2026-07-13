<!--
  RecurringPlanForm — Sub-Form für Income- und Fixed-Cost-Pläne.

  Verwendung:
  <RecurringPlanForm
    v-model="incomeForm"
    id-prefix="income"
    :currency="currencyCode"
    :budgets="currentHousehold.budgets"
    name-placeholder="z. B. Gehalt"
  />

  Felder:
  - name (string)
  - amount (number | null, EUR)
  - frequency (Frequency)
  - startDate (Date | null)
  - endDate (Date | null)
  - budgetId (string | null) — Issue #59 polish, optionales Default-
    Budget fuer Transaktionen aus diesem Plan. Hart gekoppelt (kein
    per-Transaction-Override im Mark-Dialog), aber nachtraegliche
    Aenderung im Transaction-Row-Editor bleibt moeglich.

  Begründung: Income- und Fixed-Cost-Dialog in `pages/budgeting/recurring.vue`
  waren 1:1 identisch (mit unterschiedlichen id-Prefixen und Placeholdern).
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { Frequency } from '~/types/planning'

export type RecurringPlanFormData = {
  name: string
  amount: number | null
  frequency: Frequency
  startDate: Date | null
  endDate: Date | null
  budgetId?: string | null
}

const props = defineProps<{
  modelValue: RecurringPlanFormData
  /** Prefix für input-IDs (z. B. 'income' / 'fixed'). */
  idPrefix: string
  /** ISO-Currency-Code (EUR/USD). */
  currency: string
  /** Placeholder für das Name-Feld. */
  namePlaceholder: string
  /** Issue #59 polish: Liste der Haushalts-Budgets fuer das
   *  Default-Budget-Dropdown. */
  budgets: Array<{ id: string; name: string }>
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

// Issue #59 polish: Budget-Optionen mit "Kein Budget"-Default.
// v-model-Value ist null = kein Default-Budget gesetzt.
const budgetOptions = computed(() => [
  { label: 'Kein Budget', value: null as string | null },
  ...props.budgets.map((b) => ({ label: b.name, value: b.id as string | null })),
])
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
  <!-- Issue #59 polish: optionales Default-Budget. Wird beim
       "Als bezahlt/erhalten markieren"-Flow an die neue Transaktion
       vererbt. Recurring und Budget sind orthogonale Konzepte —
       "Kein Budget" ist ein valider Default, falls der Plan bewusst
       keinem Bucket zugeordnet werden soll. -->
  <FormFieldRow label="Standard-Budget" :htmlFor="`${idPrefix}-budget`" wide>
    <Select
      :id="`${idPrefix}-budget`"
      :modelValue="modelValue.budgetId ?? null"
      @update:modelValue="(v) => update('budgetId', v ?? null)"
      :options="budgetOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Kein Budget"
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
