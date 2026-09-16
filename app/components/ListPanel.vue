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
  /**
   * Kompaktere Padding-Variante fuer dichte Listen.
   */
  compact?: boolean
}>()
</script>

<template>
  <article
    class="list-panel"
    :class="{
      'list-panel--primary': variant === 'primary',
      'list-panel--compact': compact,
    }"
  >
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
  padding: 1.1rem 1.1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 32%),
    var(--color-bg-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 18px;
  box-shadow: 0 14px 40px rgba(2, 6, 23, 0.3);
}

.list-panel--primary {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 28%),
    var(--color-bg-panel);
}

.list-panel--compact {
  padding: 0.85rem 0.85rem 1rem;
  gap: 0.65rem;
}

.list-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.list-panel__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.list-panel__copy h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}

.list-panel__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-panel-soft);
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.list-panel__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

@media (max-width: 639px) {
  .list-panel {
    padding: 1rem;
  }
}
</style>