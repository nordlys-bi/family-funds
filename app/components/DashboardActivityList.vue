<!--
  DashboardActivityList — die "Letzte Buchungen"-Liste des Dashboards.
-->
<script setup lang="ts">
const props = defineProps<{
  activity: Array<{
    id: string
    kind: 'expense' | 'income'
    amount: number
    description: string | null
    date: string
    budgetName: string | null
    userDisplayName: string | null
  }>
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
}>()
void props
</script>

<template>
  <div v-if="activity.length === 0" class="empty">
    Noch keine Buchungen in den letzten 7 Tagen.
  </div>
  <ul v-else class="list">
    <li
      v-for="entry in activity.slice(0, 5)"
      :key="entry.id"
      class="item"
    >
      <div
        class="icon"
        :class="entry.kind === 'income' ? 'icon--income' : 'icon--expense'"
      >
        <i :class="entry.kind === 'income' ? 'pi pi-arrow-down-left' : 'pi pi-arrow-up-right'" />
      </div>
      <div class="body">
        <div class="line">
          <span class="desc">{{ entry.description || (entry.kind === 'income' ? 'Einnahme' : 'Ausgabe') }}</span>
          <span
            class="amount"
            :class="entry.kind === 'income' ? 'amount--income' : 'amount--expense'"
          >
            {{ entry.kind === 'income' ? '+' : '−' }}{{ formatMoney(entry.amount) }}
          </span>
        </div>
        <div class="meta">
          {{ entry.userDisplayName || '—' }}<template v-if="entry.budgetName"> · {{ entry.budgetName }}</template>
          · {{ new Date(entry.date).toLocaleDateString('de-DE') }}
        </div>
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
  gap: 0.85rem;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  flex-shrink: 0;
}

.icon--income {
  background: var(--color-accent-success-soft);
  color: var(--color-accent-success);
}

.icon--expense {
  background: var(--color-accent-danger-soft);
  color: var(--color-accent-danger);
}

.body {
  flex: 1 1 auto;
  min-width: 0;
}

.line {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.desc {
  font-weight: 500;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.amount {
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
}

.amount--income {
  color: var(--color-accent-success-text);
}

.amount--expense {
  color: var(--color-accent-danger-text);
}

.meta {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-top: 0.15rem;
}
</style>
