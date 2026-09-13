<!--
  BudgetPeriodRing — kompakter Ring-Chart fuer eine Budget-Karte
  (verbraucht/geplant als Prozent, Severity-eingefaerbt).

  Reines inline-SVG, keine Chart-Library noetig (App rollt Ratio-Visuals
  immer selbst, siehe ListProgressBar.vue fuer den Balken-Pendant).
-->
<script setup lang="ts">
import { computed } from 'vue'

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const props = withDefaults(
  defineProps<{
    percent: number
    severity: 'ok' | 'warning' | 'over'
    size?: number
  }>(),
  { size: 64 },
)

const dashOffset = computed(() => CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, props.percent)) / 100))
const roundedPercent = computed(() => Math.round(props.percent))
</script>

<template>
  <svg
    viewBox="0 0 100 100"
    :width="size"
    :height="size"
    class="ring"
    :class="`ring--${severity}`"
    role="img"
    :aria-label="`${roundedPercent}% verwendet`"
  >
    <circle class="ring__track" cx="50" cy="50" :r="RADIUS" fill="none" stroke-width="10" />
    <circle
      class="ring__fill"
      cx="50"
      cy="50"
      :r="RADIUS"
      fill="none"
      stroke-width="10"
      stroke-linecap="round"
      :stroke-dasharray="CIRCUMFERENCE"
      :stroke-dashoffset="dashOffset"
      transform="rotate(-90 50 50)"
    />
    <text x="50" y="56" text-anchor="middle" class="ring__label">{{ roundedPercent }}%</text>
  </svg>
</template>

<style scoped>
.ring__track {
  stroke: var(--color-border-subtle);
}

.ring__fill {
  transition: stroke-dashoffset 0.25s ease;
}

.ring--ok .ring__fill {
  stroke: var(--color-accent-success);
}

.ring--warning .ring__fill {
  stroke: var(--color-accent-warning);
}

.ring--over .ring__fill {
  stroke: var(--color-accent-danger);
}

.ring__label {
  fill: var(--color-text-primary);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
