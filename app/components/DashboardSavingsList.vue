<!--
  DashboardSavingsList — die Sparziel-Progress-Liste des Dashboards.

  Pattern: pro Sparziel eine Zeile mit Name, Progressbar und
  "currentAmount / targetAmount · +monthlyRate / Monat". Wird vom
  Dashboard-Endpoint aggregiert geliefert (currentAmount = Summe
  aller SavingsGoalExecution-Amounts, siehe issue #12).
-->
<script setup lang="ts">
defineProps<{
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
}>()
</script>

<template>
  <div v-if="goals.length === 0" class="empty">
    Noch keine Sparziele — lege eins an, um deine Fortschritte zu sehen.
  </div>
  <ul v-else class="list">
    <li v-for="goal in goals" :key="goal.id" class="item">
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
</style>
