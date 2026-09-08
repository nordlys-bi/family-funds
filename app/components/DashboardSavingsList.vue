<!--
  DashboardSavingsList — die Sparziel-Progress-Liste des Dashboards.

  Pattern: pro Sparziel eine Zeile mit Name, Progressbar und
  "currentAmount / targetAmount · +monthlyRate / Monat". Wird vom
  Dashboard-Endpoint aggregiert geliefert (currentAmount = Summe
  aller SavingsGoalExecution-Amounts, siehe issue #12).

  Issue #97: Das Dashboard zeigt nur `limit` Zeilen (Default 3) + einen
  "+N weitere"-Hinweis; "Alle anzeigen" im Panel-Header fuehrt zur
  vollen Liste.
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  goals: Array<{
    id: string
    name: string
    targetAmount: number
    currentAmount: number
    monthlyRate: number
    percentToTarget: number
  }>
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
  /** Max. Anzahl sichtbarer Zeilen. `undefined` = alle. */
  limit?: number
}>()

const visible = computed(() =>
  props.limit == null ? props.goals : props.goals.slice(0, props.limit),
)
const hiddenCount = computed(() => props.goals.length - visible.value.length)
</script>

<template>
  <div v-if="goals.length === 0" class="empty">
    Noch keine Sparziele — lege eins an, um deine Fortschritte zu sehen.
  </div>
  <template v-else>
  <ul class="list">
    <li v-for="goal in visible" :key="goal.id" class="item">
      <div class="head">
        <span class="name">{{ goal.name }}</span>
        <span class="pct">{{ goal.percentToTarget.toFixed(0) }}%</span>
      </div>
      <ListProgressBar :percent="Math.min(100, goal.percentToTarget)" tone="primary" />
      <div class="meta">
        {{ formatMoney(goal.currentAmount) }} von {{ formatMoney(goal.targetAmount) }}
        <template v-if="goal.monthlyRate > 0">
          · +{{ formatMoney(goal.monthlyRate) }} / Monat
        </template>
      </div>
    </li>
  </ul>
  <p v-if="hiddenCount > 0" class="more">+ {{ hiddenCount }} weitere</p>
  </template>
</template>

<style scoped>
.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  padding: 0.5rem 0;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.35rem;
}

.name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.pct {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-accent-primary-text);
}

.meta {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  margin-top: 0.35rem;
}

.more {
  margin: 1.1rem 0 0;
  font-size: 0.78rem;
  color: var(--color-text-muted);
}
</style>
