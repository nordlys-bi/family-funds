<!--
  ItemCard — wiederkehrende Card fuer einzelne Listen-Eintraege.

  Verwendung:
  <ItemCard>
    <template #main>
      <h3>Mein Eintrag</h3>
      <p>Details</p>
    </template>
    <template #actions>
      <Button label="Bearbeiten" />
      <Button label="Loeschen" />
    </template>
  </ItemCard>
-->
<script setup lang="ts">
defineProps<{
  /**
   * Wenn 'wide', hat die Card mehr Padding. Wenn 'compact', weniger.
   * Default ist Standardgroesse.
   */
  size?: 'compact' | 'default' | 'wide'
}>()
</script>

<template>
  <article class="item-card" :class="`item-card--${size ?? 'default'}`">
    <div class="item-main">
      <slot name="main" />
    </div>
    <div v-if="$slots.actions" class="item-actions">
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.82);
}

.item-card--compact {
  padding: 0.75rem 0.9rem;
  border-radius: 14px;
}

.item-card--wide {
  padding: 1.25rem 1.4rem;
}

.item-main {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.item-main h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.item-main p {
  margin: 0;
  color: #94a3b8;
  font-size: 0.88rem;
  line-height: 1.45;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .item-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .item-actions {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
}
</style>