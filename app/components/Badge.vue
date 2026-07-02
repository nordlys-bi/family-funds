<!--
  Badge — kleines Pillen-Element für Modul-Markierungen (M3, M4, M5) in der
  Sidebar. Ersetzt die frühere `<span class="badge">`-Regel im Layout.

  Visuell: klein, fett, dezent grau, sitzt rechtsbündig in einem Nav-Item.
  Bewusst neutral gehalten, damit die M-Badges nicht mit der aktiven Nav-
  Item-Hervorhebung konkurrieren.

  Props:
    - tone: 'neutral' (default) | 'info' | 'success' | 'warning' | 'danger'
      Optional, falls das Badge mal in anderem Kontext (Status-Pillen etc.)
      eingesetzt werden soll. Aktuell werden die M-Badges als neutral
      gerendert.
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  }>(),
  { tone: 'neutral' },
)
</script>

<template>
  <span class="badge" :class="`badge--${tone}`">
    <slot />
  </span>
</template>

<style scoped>
.badge {
  /* Layout — `margin-left: auto` schiebt das Badge in einem Flex-Nav-Item
     ganz nach rechts. */
  margin-left: auto;

  /* Typografie */
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;

  /* Form */
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-sm);

  /* Default neutral */
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
}

.badge--info {
  background: rgba(59, 130, 246, 0.14);
  color: var(--color-accent-primary-text);
  border-color: rgba(59, 130, 246, 0.24);
}

.badge--success {
  background: rgba(16, 185, 129, 0.14);
  color: var(--color-accent-success-text);
  border-color: rgba(16, 185, 129, 0.24);
}

.badge--warning {
  background: rgba(245, 158, 11, 0.14);
  color: var(--color-accent-warning-text);
  border-color: rgba(245, 158, 11, 0.24);
}

.badge--danger {
  background: rgba(239, 68, 68, 0.14);
  color: var(--color-accent-danger-text);
  border-color: rgba(239, 68, 68, 0.24);
}
</style>