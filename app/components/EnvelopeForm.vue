<!--
  EnvelopeForm — Felder eines Umschlags (ADR-0005).

  Die Gruppe beschreibt den Anwendungsfall und setzt beim Anlegen Vorgaben
  (im Dialog, der das Formular umgibt), verbietet aber keine Eigenschaft: Ein
  Sparziel darf eine Zuteilung haben, eine Ruecklage ein Ziel.

  `frequencyLocked`: Beim Bearbeiten sind Frequenz und Start fest — eine andere
  Periodizitaet heisst neuer Umschlag, in den der alte geschlossen wird.
-->
<script setup lang="ts">
import type { Frequency } from '~/types/planning'
import { ENVELOPE_GROUPS, type AllocationSource, type EnvelopeGroup } from '~/utils/envelope-options'

export type EnvelopeFormData = {
  name: string
  group: EnvelopeGroup
  allocationSource: AllocationSource
  amount: number | null
  targetAmount: number | null
  frequency: Frequency
  validFrom: Date
}

const props = defineProps<{
  modelValue: EnvelopeFormData
  currency: string
  frequencyLocked?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EnvelopeFormData]
}>()

const groupOptions = ENVELOPE_GROUPS.map((group) => ({ label: group.label, value: group.value }))
const allocationOptions = [
  { label: 'Keine', value: 'NONE' },
  { label: 'Fester Betrag', value: 'FIXED' },
  { label: 'Aus Fixkosten-Plänen', value: 'PLANS' },
]

function patch<K extends keyof EnvelopeFormData>(
  key: K,
  value: EnvelopeFormData[K],
) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <FormFieldRow label="Name" htmlFor="envelope-name" wide>
    <InputText
      id="envelope-name"
      :modelValue="modelValue.name"
      @update:modelValue="(v) => patch('name', v ?? '')"
      placeholder="z. B. Lebensmittel"
    />
  </FormFieldRow>
  <FormFieldRow label="Gruppe" htmlFor="envelope-group" wide>
    <Select
      id="envelope-group"
      :modelValue="modelValue.group"
      @update:modelValue="(v) => patch('group', v ?? 'RUNNING')"
      :options="groupOptions"
      optionLabel="label"
      optionValue="value"
    />
  </FormFieldRow>
  <FormFieldRow label="Zuteilung" htmlFor="envelope-allocation-source" wide>
    <Select
      id="envelope-allocation-source"
      :modelValue="modelValue.allocationSource"
      @update:modelValue="(v) => patch('allocationSource', v ?? 'NONE')"
      :options="allocationOptions"
      optionLabel="label"
      optionValue="value"
    />
  </FormFieldRow>
  <FormFieldRow v-if="modelValue.allocationSource === 'FIXED'" label="Betrag je Periode" htmlFor="envelope-amount">
    <MoneyInput
      id="envelope-amount"
      :modelValue="modelValue.amount"
      @update:modelValue="(v) => patch('amount', v)"
      :currency="currency"
    />
    <small v-if="frequencyLocked" class="envelope-form__hint">
      Ein neuer Betrag gilt ab der nächsten Periode.
    </small>
  </FormFieldRow>
  <FormFieldRow v-if="modelValue.allocationSource !== 'NONE'" label="Frequenz" htmlFor="envelope-frequency">
    <Select
      id="envelope-frequency"
      :modelValue="modelValue.frequency"
      @update:modelValue="(v) => patch('frequency', v ?? 'MONTHLY')"
      :options="frequencySelectOptions()"
      optionLabel="label"
      optionValue="value"
      :disabled="frequencyLocked"
    />
    <small v-if="frequencyLocked" class="envelope-form__hint">
      Frequenz ist fest. Für eine andere Frequenz einen neuen Umschlag anlegen und diesen hinein schließen.
    </small>
  </FormFieldRow>
  <FormFieldRow label="Sparziel (optional)" htmlFor="envelope-target">
    <MoneyInput
      id="envelope-target"
      :modelValue="modelValue.targetAmount"
      @update:modelValue="(v) => patch('targetAmount', v)"
      :currency="currency"
    />
  </FormFieldRow>
  <FormFieldRow v-if="!frequencyLocked" label="Gültig ab" htmlFor="envelope-valid-from">
    <DatePicker
      id="envelope-valid-from"
      :modelValue="modelValue.validFrom"
      @update:modelValue="(v) => patch('validFrom', v ?? new Date())"
      showIcon
      dateFormat="dd.mm.yy"
    />
  </FormFieldRow>
</template>

<style scoped>
.envelope-form__hint {
  display: block;
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}
</style>
