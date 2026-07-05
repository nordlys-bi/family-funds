<!--
  MoneyInput — Wrapper um PrimeVue InputNumber mit Currency-Modus.

  Verwendung:
  <MoneyInput id="my-amount" v-model="form.amount" :currency="currencyCode" />

  Verhalten:
  - mode="currency" mit de-DE Locale (Komma als Dezimaltrennzeichen).
  - Speichert den Wert als Number in Euro (nicht Cent). Server skaliert per
    parseMoneyToCents auf ganze Cent.
  - Setzt minFractionDigits=2 / maxFractionDigits=2 (Pflicht: Geldbeträge).
  - Touch-Target-konform via form-field-height aus base.css.
  - Forwarded Props: placeholder, disabled, min, max.
  - id-Prop wird an PrimeVue `inputId` weitergereicht, damit <label for="...">
    korrekt auf das innere <input> zeigt (statt auf den Wrapper).

  Migration: ersetzt <InputText inputmode="decimal" placeholder="0,00">.
  Vorher:  form.amount = "12,50"  (string, Server parst manuell)
  Nachher: form.amount = 12.5     (number, Server via parseMoneyToCents)
-->
<script setup lang="ts">
defineProps<{
  modelValue: number | null
  /** ISO-Currency-Code (z. B. 'EUR', 'USD'). Default 'EUR'. */
  currency?: string
  placeholder?: string
  disabled?: boolean
  /** Min-Wert in der Currency-Einheit (z. B. 0 für nicht-negative Beträge). */
  min?: number
  max?: number
  /** DOM-ID des inneren <input>. Wird via PrimeVue inputId an den
      <input> weitergereicht, damit <label for="..."> das Feld korrekt
      fokussiert. */
  id?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()
</script>

<template>
  <InputNumber
    :modelValue="modelValue"
    mode="currency"
    :currency="currency ?? 'EUR'"
    locale="de-DE"
    :minFractionDigits="2"
    :maxFractionDigits="2"
    :placeholder="placeholder ?? '0,00'"
    :disabled="disabled ?? false"
    :min="min"
    :max="max"
    :inputId="id"
    fluid
    @update:modelValue="(v) => $emit('update:modelValue', v)"
  />
</template>
