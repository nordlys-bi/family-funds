<!--
  BudgetListRow — eine Zeile der kompakten Budget-Liste (ADR-0004).

  Der Saldo steht gross und farbig rechts, daneben der Trend der letzten
  3 Monate (gleiche Sparkline wie auf dem Dashboard) — er ist die Haupt-
  zahl eines virtuellen Kontos. Die laufende Periode steht nur kompakt als
  verbraucht/zugeteilt darunter; Details, Verlauf und Aktionen liegen auf
  der Detailseite, auf die die ganze Zeile verlinkt.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { BudgetListItem } from '~/types/budget'

const props = defineProps<{
  budget: BudgetListItem
  formatMoney: (cents: number) => string
  /** Name des Ziel-Budgets bei geschlossenen Budgets. */
  targetName?: string | null
}>()

const balance = computed(() => props.budget.balance?.balance ?? 0)
// Stichtag erreicht: Der Endsaldo steckt bereits im Ziel-Budget (ADR-0004),
// also neutral statt gruen/rot. Ein Stichtag in der Zukunft ist noch offen.
const isClosed = computed(() => Boolean(props.budget.closedAt && new Date(props.budget.closedAt) <= new Date()))
const period = computed(() => props.budget.currentPeriod)
const periodLabel = computed(() =>
  period.value ? formatBudgetPeriodLabel(props.budget.frequency, period.value.start, period.value.end) : null,
)
</script>

<template>
  <NuxtLink :to="`/budgeting/budgets/${budget.id}`" class="budget-row" :class="{ 'budget-row--closed': isClosed }">
    <div class="budget-row__main">
      <span class="budget-row__name">{{ budget.name }}</span>
      <span class="budget-row__sub">
        <span class="budget-row__tag">{{ frequencyLabel(budget.frequency) }}</span>
        <span v-if="isClosed" class="budget-row__closed">
          geschlossen → {{ targetName ?? '—' }}
        </span>
        <span v-else-if="budget.closedAt" class="budget-row__closed">
          schließt am {{ formatPlanningDate(budget.closedAt) }} → {{ targetName ?? "—" }}
        </span>
        <span v-if="!isClosed && period" class="budget-row__period">
          {{ periodLabel }}: {{ formatMoney(period.spentAmount) }} / {{ formatMoney(period.plannedAmount) }}
        </span>
      </span>
      <ListProgressBar
        v-if="!isClosed && period"
        class="budget-row__progress"
        :percent="period.percentUsed"
        :tone="period.severity"
      />
    </div>
    <div class="budget-row__aside">
      <span
        class="budget-row__balance"
        :class="{ 'is-negative': balance < 0 && !isClosed, 'is-closed': isClosed }"
        :title="isClosed ? 'Endsaldo — steckt bereits im Ziel-Budget' : undefined"
      >{{ formatMoney(balance) }}</span>
      <BudgetBalanceSparkline :values="budget.balanceTrend" :width="64" :height="18" />
    </div>
    <i class="pi pi-chevron-right budget-row__chevron" aria-hidden="true" />
  </NuxtLink>
</template>

<style scoped>
.budget-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.8rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg, 12px);
  color: inherit;
  text-decoration: none;
  min-width: 0;
}

.budget-row:hover {
  border-color: var(--color-border-default);
}

.budget-row:hover .budget-row__name {
  color: var(--color-accent-primary-text);
}

.budget-row:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.budget-row--closed {
  opacity: 0.75;
}

.budget-row__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.budget-row__name {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.budget-row__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.budget-row__tag {
  padding: 1px 7px;
  background: rgba(59, 130, 246, 0.16);
  color: var(--color-accent-primary-text);
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.budget-row__closed {
  padding: 1px 7px;
  background: rgba(148, 163, 184, 0.16);
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
}

.budget-row__progress {
  max-width: 220px;
}

.budget-row__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  flex-shrink: 0;
}

.budget-row__balance {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent-success-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.budget-row__balance.is-negative {
  color: var(--color-accent-danger-text);
}

.budget-row__balance.is-closed {
  color: var(--color-text-secondary);
}

.budget-row__chevron {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
