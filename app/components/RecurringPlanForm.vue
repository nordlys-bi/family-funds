<!--
  RecurringPlanForm — Sub-Form für Income- und Fixed-Cost-Pläne.

  Verwendung:
  <RecurringPlanForm
    v-model="incomeForm"
    id-prefix="income"
    :currency="currencyCode"
    :envelopes="envelopes"
    name-placeholder="z. B. Gehalt"
  />

  Felder:
  - name (string)
  - amount (number | null, EUR)
  - frequency (Frequency)
  - startDate (Date | null)
  - endDate (Date | null)
  - envelopeId (string | null) — Umschlag des Plans (ADR-0005). Buchungen aus
    dem Plan erben ihn, ein Fixkosten-Umschlag mit Zuteilung aus Plaenen teilt
    daraus zu. null = "Zu verteilen".
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
  envelopeId?: string | null
}

const props = defineProps<{
  modelValue: RecurringPlanFormData
  /** Prefix für input-IDs (z. B. 'income' / 'fixed'). */
  idPrefix: string
  /** ISO-Currency-Code (EUR/USD). */
  currency: string
  /** Placeholder für das Name-Feld. */
  namePlaceholder: string
  /** Umschlaege des Haushalts fuer die Auswahl; geschlossene nur, wenn der Plan schon daran haengt. */
  envelopes: Array<{ id: string; name: string; closedAt?: string | Date | null }>
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

const envelopeOptions = computed(() => [
  { label: 'Zu verteilen', value: null as string | null },
  ...props.envelopes
    .filter((envelope) => !envelope.closedAt || envelope.id === props.modelValue.envelopeId)
    .map((envelope) => ({ label: envelope.name, value: envelope.id as string | null })),
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
  <!-- Buchungen aus dem Plan erben den Umschlag (issue #59). -->
  <FormFieldRow label="Umschlag" :htmlFor="`${idPrefix}-envelope`" wide>
    <Select
      :id="`${idPrefix}-envelope`"
      :modelValue="modelValue.envelopeId ?? null"
      @update:modelValue="(v) => update('envelopeId', v ?? null)"
      :options="envelopeOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Zu verteilen"
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
