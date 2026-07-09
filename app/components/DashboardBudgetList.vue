<!--
  DashboardBudgetList — die Budget-Auslastungs-Liste des Dashboards.

  Eigene Komponente, weil im Dashboard mehrere Stellen den gleichen
  "Top-3-Alerts"-Render-Pfad brauchen. Pattern:
  <ListPanel :title="..." :badge="...">
    <template #actions>...</template>
    <DashboardBudgetList :alerts="..." />
  </ListPanel>
-->
<script setup lang="ts">
const props = defineProps<{
  alerts: Array<{
    budgetId: string
    name: string
    plannedAmount: number
    spentAmount: number
    remainingAmount: number
    percentUsed: number
    severity: 'ok' | 'warning' | 'over'
  }>
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
}>()
void props
</script>

<template>
  <div v-if="alerts.length === 0" class="empty">
    Noch keine Budgets — Budgets helfen, geplante Ausgaben im Auge zu behalten.
  </div>
  <ul v-else class="list">
    <li v-for="alert in alerts" :key="alert.budgetId" class="item">
      <div class="head">
        <span class="name">{{ alert.name }}</span>
        <span class="pct" :class="`pct--${alert.severity}`">
          {{ alert.percentUsed.toFixed(0) }}%
        </span>
      </div>
      <ListProgressBar :percent="alert.percentUsed" :tone="alert.severity" />
      <div class="meta">
        {{ formatMoney(alert.spentAmount) }} von {{ formatMoney(alert.plannedAmount) }}
        · noch {{ formatMoney(alert.remainingAmount) }}
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
}

.pct {
  font-weight: 600;
  font-size: 0.85rem;
}

.pct--ok {
  color: var(--color-text-secondary);
}
.pct--warning {
  color: var(--color-accent-warning-text);
}
.pct--over {
  color: var(--color-accent-danger-text);
}

.meta {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  margin-top: 0.35rem;
}
</style>
