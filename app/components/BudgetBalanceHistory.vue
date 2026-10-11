<!--
  BudgetBalanceHistory — aufklappbarer Saldo-Verlauf eines Budgets auf der
  Budget-Seite (ADR-0004). Laedt `.../budgets/:id/balance-history` erst beim
  Aufklappen (die Komponente wird nur dann gemountet) und pro Zeitraum neu.

  Die Ereignisse stehen zusaetzlich als Liste unter dem Chart: `<title>`-
  Tooltips gibt es auf Touch-Geraeten nicht, und dort wird die Seite
  hauptsaechlich benutzt.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { BalanceChartEvent } from './BudgetBalanceChart.vue'

type HistoryEvent = {
  type: 'transfer' | 'version' | 'carryover'
  date: string
  amount: number
  budgetId: string
  budgetName: string | null
  fromBudgetId?: string
  fromBudgetName?: string | null
}

type HistoryResponse = {
  budgetId: string
  from: string
  to: string
  points: Array<{ date: string; balance: number }>
  events: HistoryEvent[]
  chain: Array<{ id: string; name: string }>
}

const props = defineProps<{
  householdId: string
  budgetId: string
  formatMoney: (cents: number) => string
}>()

const RANGES = [
  { months: 1, label: '1 M' },
  { months: 3, label: '3 M' },
  { months: 6, label: '6 M' },
  { months: 12, label: '12 M' },
] as const

// Default 3 Monate (abgestimmt): lang genug fuer ein paar Monatsperioden,
// kurz genug, dass Wochenstufen noch erkennbar sind.
const months = ref(3)
const history = ref<HistoryResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

function isoDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function load() {
  loading.value = true
  error.value = null
  const to = new Date()
  const from = new Date(to)
  from.setMonth(from.getMonth() - months.value)
  try {
    history.value = await $fetch<HistoryResponse>(
      `/api/households/${props.householdId}/budgets/${props.budgetId}/balance-history`,
      { query: { from: isoDay(from), to: isoDay(to) } },
    )
  } catch (err: any) {
    error.value = err?.statusMessage || err?.message || 'Verlauf konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(months, load)

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${day}.${month}.`
}

function describeEvent(event: HistoryEvent): string {
  switch (event.type) {
    case 'transfer':
      return event.amount >= 0
        ? `Umbuchung in Spartopf −${props.formatMoney(event.amount)}`
        : `Umbuchung aus Spartopf +${props.formatMoney(-event.amount)}`
    case 'version':
      return `Neue Zuteilung ${props.formatMoney(event.amount)} pro Periode`
    case 'carryover':
      return `Übertrag aus „${event.fromBudgetName ?? 'Vorgänger'}“ ${props.formatMoney(event.amount)}`
  }
}

/** Bei Ketten dazuschreiben, welches Budget gemeint ist — sonst ist "Neue Zuteilung" mehrdeutig. */
function label(event: HistoryEvent): string {
  const text = describeEvent(event)
  const isOwn = event.budgetId === props.budgetId
  return isOwn || !event.budgetName ? text : `${text} (${event.budgetName})`
}

const chartEvents = computed<BalanceChartEvent[]>(() =>
  (history.value?.events ?? []).map((event) => ({
    type: event.type,
    date: event.date,
    label: `${shortDate(event.date)} ${label(event)}`,
  })),
)

const predecessorNames = computed(() =>
  (history.value?.chain ?? []).filter((budget) => budget.id !== props.budgetId).map((budget) => budget.name),
)
</script>

<template>
  <section class="balance-history" aria-label="Saldo-Verlauf">
    <div class="balance-history__head">
      <span class="balance-history__title">Saldo-Verlauf</span>
      <div class="balance-history__ranges" role="group" aria-label="Zeitraum">
        <button
          v-for="range in RANGES"
          :key="range.months"
          type="button"
          class="balance-history__range"
          :class="{ 'is-active': months === range.months }"
          :aria-pressed="months === range.months"
          @click="months = range.months"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <p v-if="error" class="balance-history__error">{{ error }}</p>
    <div v-else-if="!history" class="balance-history__placeholder">Lade Verlauf …</div>
    <template v-else>
      <BudgetBalanceChart
        :class="{ 'is-loading': loading }"
        :points="history.points"
        :events="chartEvents"
        :range="{ from: history.from, to: history.to }"
        :format-money="formatMoney"
      />
      <p v-if="predecessorNames.length > 0" class="balance-history__note">
        Enthält den Verlauf von {{ predecessorNames.map((name) => `„${name}“`).join(', ') }} vor dem Übertrag.
      </p>
      <ul v-if="history.events.length > 0" class="balance-history__events">
        <li
          v-for="(event, index) in history.events"
          :key="`${event.type}-${event.date}-${index}`"
          class="balance-history__event"
          :class="`balance-history__event--${event.type}`"
        >
          <span class="balance-history__event-date">{{ shortDate(event.date) }}</span>
          <span>{{ label(event) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.balance-history {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* Rechts etwas Luft: Die Liste hat mobil keinen Seitenrand, Chart und
     Zeitraum-Schalter klebten sonst am Bildschirmrand. */
  padding: 0.6rem 0.75rem 0.6rem 1.25rem;
  margin: 0.4rem 0 0.8rem;
  border-left: 2px solid var(--color-border-default);
  min-width: 0;
}

.balance-history__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.balance-history__title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.balance-history__ranges {
  display: inline-flex;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.balance-history__range {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
}

.balance-history__range + .balance-history__range {
  border-left: 1px solid var(--color-border-default);
}

.balance-history__range.is-active {
  background: var(--color-accent-primary);
  color: #fff;
}

.balance-history__range:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.balance-history__placeholder,
.balance-history__note {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  margin: 0;
}

.balance-history__error {
  color: var(--color-accent-danger-text);
  font-size: 0.8rem;
  margin: 0;
}

.balance-history__events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.balance-history__event {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

/* Farbpunkt = gleiche Farbe wie der Marker im Chart */
.balance-history__event::before {
  content: '';
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  align-self: center;
}

.balance-history__event--transfer::before {
  background: var(--color-accent-warning);
}

.balance-history__event--version::before {
  background: var(--color-accent-primary);
}

.balance-history__event--carryover::before {
  background: var(--color-accent-success);
}

.balance-history__event-date {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 3.2rem;
}
</style>
