<!--
  KpiCard — kompakte Statistik-Karte fuer Dashboards und Uebersichts-Pages.

  Verwendung:
  <KpiCard
    tone="success"
    icon="pi pi-arrow-up-right"
    label="Einnahmen"
    :value="formatMoney(1500)"
    meta="Juli 2026"
  />

  Tone-Mapping (greift auf tokens.css zu):
    success  -> --color-accent-success(-soft/-text)
    danger   -> --color-accent-danger(-soft/-text)
    primary  -> --color-accent-primary(-soft/-text)
    warning  -> --color-accent-warning(-soft/-text)
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'success' | 'danger' | 'primary' | 'warning'
    icon?: string
    label: string
    value: string | number
    meta?: string
  }>(),
  { tone: 'primary' },
)
</script>

<template>
  <article class="kpi-card" :class="`kpi-card--${tone}`">
    <div class="kpi-card__row">
      <div class="kpi-card__copy">
        <span class="kpi-card__label">{{ label }}</span>
        <div class="kpi-card__value" :class="`kpi-card__value--${tone}`">{{ value }}</div>
        <span v-if="meta" class="kpi-card__meta">{{ meta }}</span>
      </div>
      <div v-if="icon" class="kpi-card__icon" :class="`kpi-card__icon--${tone}`">
        <i :class="icon" />
      </div>
    </div>
  </article>
</template>

<style scoped>
.kpi-card {
  background: rgba(30, 41, 59, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.kpi-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12);
}

.kpi-card__row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.kpi-card__copy {
  min-width: 0;
  flex: 1 1 auto;
}

.kpi-card__label {
  display: block;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin-bottom: 0.35rem;
}

.kpi-card__value {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.kpi-card__value--success {
  color: var(--color-accent-success-text);
}
.kpi-card__value--danger {
  color: var(--color-accent-danger-text);
}
.kpi-card__value--primary {
  color: var(--color-accent-primary-text);
}
.kpi-card__value--warning {
  color: var(--color-accent-warning-text);
}

.kpi-card__meta {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-subtle);
  margin-top: 0.25rem;
}

.kpi-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  flex-shrink: 0;
}

.kpi-card__icon--success {
  background: var(--color-accent-success-soft);
  color: var(--color-accent-success);
}
.kpi-card__icon--danger {
  background: var(--color-accent-danger-soft);
  color: var(--color-accent-danger);
}
.kpi-card__icon--primary {
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary);
}
.kpi-card__icon--warning {
  background: var(--color-accent-warning-soft);
  color: var(--color-accent-warning);
}
</style>
