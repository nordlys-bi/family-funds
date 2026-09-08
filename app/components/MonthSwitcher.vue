<!--
  MonthSwitcher — einheitlicher Monatswähler (issue #96).

  `‹ August 2026 ›`-Stepper mit „Jetzt"-Badge für den aktuellen Monat.
  Ersetzt zwei vorher divergierende Muster:
   - `<Select>`-Dropdown auf /transactions/expenses + /income
   - Inline-Stepper auf /budgeting/budgets

  Routing-agnostisch wie useTransactionList: die Komponente kennt nur
  `modelValue` (YYYY-MM) und emittiert `update:modelValue` bei Prev/Next.
  URL-Sync + Reload macht die Page selbst (z. B. via `onMonthChange`).

  Verwendung:
    <MonthSwitcher :model-value="month" :loading="loading" @update:model-value="onMonthChange" />

  Props:
   - modelValue: aktueller Monat als `YYYY-MM`.
   - loading:    deaktiviert die Prev/Next-Buttons während eines Reloads.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { currentMonthYYYYMM, formatMonthLabel, isValidMonthYYYYMM } from '~/utils/month-filter'

const props = withDefaults(
  defineProps<{
    modelValue: string
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const label = computed(() => formatMonthLabel(props.modelValue))
const isCurrentMonth = computed(() => props.modelValue === currentMonthYYYYMM())

// Reines Date-Arithmetic, kein State. `currentMonthYYYYMM` normalisiert
// den geshifteten Monat wieder auf `YYYY-MM`.
function shiftMonth(delta: number): string {
  const [yearStr, monthStr] = props.modelValue.split('-')
  const shifted = new Date(Number(yearStr), Number(monthStr) - 1 + delta, 1)
  return currentMonthYYYYMM(shifted)
}
const prevMonth = computed(() => shiftMonth(-1))
const nextMonth = computed(() => shiftMonth(1))

function go(target: string) {
  if (!props.loading && isValidMonthYYYYMM(target)) emit('update:modelValue', target)
}
</script>

<template>
  <div class="month-switcher" role="group" aria-label="Monatsauswahl">
    <Button
      icon="pi pi-chevron-left"
      severity="secondary"
      text
      rounded
      :disabled="loading"
      :aria-label="`Vorheriger Monat (${formatMonthLabel(prevMonth)})`"
      :title="formatMonthLabel(prevMonth)"
      @click="go(prevMonth)"
    />
    <div class="month-switcher__center">
      <span class="month-switcher__label">{{ label }}</span>
      <Tag v-if="isCurrentMonth" severity="success" value="Jetzt" class="month-switcher__badge" />
    </div>
    <Button
      icon="pi pi-chevron-right"
      severity="secondary"
      text
      rounded
      :disabled="loading"
      :aria-label="`Nächster Monat (${formatMonthLabel(nextMonth)})`"
      :title="formatMonthLabel(nextMonth)"
      @click="go(nextMonth)"
    />
  </div>
</template>

<style scoped>
/* Übernommen aus dem bisherigen budgets.vue-Stepper (issue #34), damit
   die Optik 1:1 gleich bleibt. */
.month-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.month-switcher__center {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 8rem;
  padding: 0 8px;
}

.month-switcher__label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary, #f1f5f9);
  white-space: nowrap;
}

.month-switcher__badge {
  font-size: 0.65rem !important;
  padding: 1px 6px !important;
}
</style>
