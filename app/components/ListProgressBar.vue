<!--
  ListProgressBar — schmale horizontale Leiste mit Farbabstufung nach %.

  Verwendung:
  <ListProgressBar :percent="42" />
  <ListProgressBar :percent="85" tone="warning" />
  <ListProgressBar :percent="120" tone="over" />

  Hinweis: Wir nennen die Komponente bewusst NICHT "ProgressBar", weil
  PrimeVue bereits einen ProgressBar global registriert (p-progressbar).
  Würden wir den Namen teilen, würde Nuxt-Auto-Import PrimeVues
  ProgressBar auflösen statt unserer schmalen Listen-Variante.
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Prozentwert (0-100+). Werte > 100 sind erlaubt fuer Over-Budget. */
    percent: number
    /** Farbabstufung. 'auto' waehlt nach Schwellen: <80 ok, 80-100 warning, >100 over. */
    tone?: 'auto' | 'ok' | 'warning' | 'over'
    /** Breite (CSS). Default 100%. */
    width?: string
    /** Inline-Label rechts (z. B. "18,06 € / 1.000,00 €"). */
    label?: string
  }>(),
  { tone: 'auto', width: '100%' },
)
</script>

<template>
  <div class="progress" :style="{ width }">
    <div
      class="progress__bar"
      :class="`progress__bar--${tone}`"
    >
      <div
        class="progress__fill"
        :style="{ width: `${Math.min(100, percent)}%` }"
      />
      <div
        v-if="percent > 100"
        class="progress__overflow"
        :style="{ width: `${Math.min(100, percent - 100)}%` }"
      />
    </div>
    <span v-if="label" class="progress__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress__bar {
  flex: 1;
  height: 6px;
  background: rgba(148, 163, 184, 0.14);
  border-radius: 999px;
  overflow: hidden;
  display: flex;
  position: relative;
}

.progress__fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.18s ease;
}

.progress__overflow {
  position: absolute;
  left: 100%;
  top: 0;
  height: 100%;
  background: var(--danger, #ef4444);
  border-radius: 999px;
  transform: translateX(-100%);
}

.progress__bar--auto .progress__fill {
  background: #34d399;
}
.progress__bar--ok .progress__fill {
  background: #34d399;
}
.progress__bar--warning .progress__fill {
  background: #fbbf24;
}
.progress__bar--over .progress__fill {
  background: #f87171;
}

.progress__label {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>