<!--
  ListPanel — Card-Wrapper fuer eine Sektion in einer Page.

  Verwendung:
  <ListPanel title="Budgets" badge="5 Eintraege">
    <template #actions>
      <Button label="Neu" @click="open" />
    </template>
    <ItemCard v-for="budget in budgets" :key="budget.id">
      <template #main>...</template>
    </ItemCard>
  </ListPanel>
-->
<script setup lang="ts">
defineProps<{
  /**
   * Kicker-Text oberhalb des Titels (z. B. "Budget", "Einnahmen").
   */
  kicker?: string
  /**
   * Section-Titel als grosse Ueberschrift.
   */
  title: string
  /**
   * Optionaler Text in einem Pill rechts (z. B. "5 Eintraege").
   */
  badge?: string
  /**
   * Visueller Stil. 'primary' fuer die erste/hauptsaechliche Card, sonst
   * 'default'.
   */
  variant?: 'default' | 'primary'
}>()
</script>

<template>
  <article class="list-panel" :class="{ 'list-panel--primary': variant === 'primary' }">
    <div class="list-panel__head">
      <div class="list-panel__copy">
        <Kicker v-if="kicker">{{ kicker }}</Kicker>
        <h2>{{ title }}</h2>
        <slot name="subtitle" />
      </div>
      <div v-if="$slots.actions || badge" class="list-panel__actions">
        <span v-if="badge" class="panel-badge">{{ badge }}</span>
        <slot name="actions" />
      </div>
    </div>

    <div class="list-panel__body">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.list-panel {
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 100%;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 28px;
  box-shadow:
    0 30px 80px rgba(2, 6, 23, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.list-panel--primary {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(9, 13, 22, 0.98));
}

.list-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.list-panel__copy {
  flex: 1 1 auto;
  min-width: 0;
}

.list-panel__copy h2 {
  margin: 0;
  font-size: 1.35rem;
  color: #f8fafc;
  letter-spacing: -0.03em;
}

.list-panel__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel-badge {
  flex-shrink: 0;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(30, 41, 59, 0.9);
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 700;
}

.list-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (max-width: 720px) {
  .list-panel {
    padding: 1.2rem;
  }
}
</style>