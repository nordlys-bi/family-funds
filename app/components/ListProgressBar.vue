<!--
  ListProgressBar — schmale horizontale Leiste mit Farbabstufung nach %.

  Verwendung:
  <ListProgressBar :percent="42" />
  <ListProgressBar :percent="85" tone="warning" />
  <ListProgressBar :percent="120" tone="over" />
  <ListProgressBar :percent="null" tone="over" />  (nichts verfuegbar)

  Hinweis: Wir nennen die Komponente bewusst NICHT "ProgressBar", weil
  PrimeVue bereits einen ProgressBar global registriert (p-progressbar).
  Würden wir den Namen teilen, würde Nuxt-Auto-Import PrimeVues
  ProgressBar auflösen statt unserer schmalen Listen-Variante.
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /**
     * Prozentwert (0-100+). Ueber 100 wird der Balken auf den Gesamtwert
     * skaliert: Bei 155 % endet die normale Fuellung bei 100/155 der Breite,
     * dort sitzt eine Markierung, dahinter ist der Ueberzug rot — so stimmen
     * die Proportionen. `null` = im Minus ohne verfuegbares Geld, alles ist Ueberzug.
     */
    percent: number | null
    /**
     * Farbabstufung. 'auto' waehlt nach Schwellen: <80 ok, 80-100 warning, >100 over.
     * 'accent' (blau) ist fuer "unterwegs zu einem Ziel" gedacht (Sparziele, issue
     * #100): 'ok' (gruen) bleibt dort dem erreichten Ziel vorbehalten.
     */
    tone?: 'auto' | 'ok' | 'warning' | 'over' | 'accent'
    /** Breite (CSS). Default 100%. */
    width?: string
    /** Inline-Label rechts (z. B. "18,06 € / 1.000,00 €"). */
    label?: string
  }>(),
  { tone: 'auto', width: '100%' },
)

const fillWidth = computed(() => {
  if (props.percent === null) return 0
  return props.percent > 100 ? (100 / props.percent) * 100 : Math.max(0, props.percent)
})
const isOver = computed(() => props.percent === null || props.percent > 100)
</script>

<template>
  <div class="progress" :style="{ width }">
    <div
      class="progress__bar"
      :class="`progress__bar--${tone}`"
    >
      <div class="progress__fill" :style="{ width: `${fillWidth}%` }" />
      <div v-if="isOver" class="progress__overflow" />
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
  background: var(--color-border-default);
  border-radius: 999px;
  overflow: hidden;
  display: flex;
}

.progress__fill {
  height: 100%;
  transition: width 0.18s ease;
}

.progress__overflow {
  flex: 1;
  height: 100%;
  background: var(--danger, #ef4444);
  /* Markierung: hier endet, was verfuegbar war. */
  border-left: 2px solid var(--color-text-primary);
}

.progress__bar--auto .progress__fill {
  background: #34d399;
}
.progress__bar--ok .progress__fill {
  background: #34d399;
}
.progress__bar--accent .progress__fill {
  background: var(--color-accent-primary, #3b82f6);
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