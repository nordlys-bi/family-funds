<!--
  BudgetBalanceSparkline — kompakter Saldo-Trend ohne Achsen fuers Dashboard
  (ADR-0004). Gleiche Geometrie und Farblogik wie BudgetBalanceChart.vue,
  nur auf Wochen-Stichproben aus dem Dashboard-Snapshot — kein eigener
  Request pro Budget.

  Die Nulllinie wird nur gezeichnet, wenn der Verlauf sie erreicht; sonst
  waere sie bei durchgehend positivem Saldo nur Rauschen am unteren Rand.
-->
<script setup lang="ts">
import { computed, useId } from 'vue'
import { buildSparklineGeometry } from '~/utils/balance-chart'

const props = withDefaults(
  defineProps<{
    values: number[]
    width?: number
    height?: number
    /** Volle Breite des Containers: `width` ist dann nur die interne
     *  Koordinatenbreite, das SVG wird horizontal gestreckt (#148). */
    fluid?: boolean
  }>(),
  { width: 72, height: 20, fluid: false },
)

const geometry = computed(() => buildSparklineGeometry(props.values, props.width, props.height))
const touchesZero = computed(() => props.values.some((value) => value <= 0))

/** Haelfte von `stroke-width` der Linie (CSS unten). */
const LINE_HALF_WIDTH = 0.75

const uid = useId()
const clipAbove = `${uid}-above`
const clipBelow = `${uid}-below`
</script>

<template>
  <svg
    v-if="values.length > 1"
    class="sparkline"
    :class="{ 'sparkline--fluid': fluid }"
    :width="fluid ? '100%' : width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    :preserveAspectRatio="fluid ? 'none' : undefined"
    aria-hidden="true"
  >
    <defs>
      <!-- Grenze eine halbe Strichbreite unter null, siehe BudgetBalanceChart.vue -->
      <clipPath :id="clipAbove">
        <rect x="0" y="0" :width="width" :height="Math.max(0, geometry.zeroY + LINE_HALF_WIDTH)" />
      </clipPath>
      <clipPath :id="clipBelow">
        <rect x="0" :y="geometry.zeroY + LINE_HALF_WIDTH" :width="width" :height="Math.max(0, height - geometry.zeroY - LINE_HALF_WIDTH)" />
      </clipPath>
    </defs>
    <path :d="geometry.areaPath" class="sparkline__area sparkline__area--negative" :clip-path="`url(#${clipBelow})`" />
    <line v-if="touchesZero" x1="0" :x2="width" :y1="geometry.zeroY" :y2="geometry.zeroY" class="sparkline__zero" />
    <path :d="geometry.linePath" class="sparkline__line" :clip-path="`url(#${clipAbove})`" />
    <path :d="geometry.linePath" class="sparkline__line sparkline__line--negative" :clip-path="`url(#${clipBelow})`" />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  flex-shrink: 0;
  overflow: visible;
}

.sparkline--fluid {
  width: 100%;
}

/* Beim horizontalen Strecken (fluid) sollen Linien nicht mitverbreitert
   bzw. verzerrt werden — Strichstaerke bleibt in Bildschirm-Pixeln. */
.sparkline__zero,
.sparkline__line {
  vector-effect: non-scaling-stroke;
}

.sparkline__zero {
  stroke: var(--color-text-muted);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.sparkline__area--negative {
  fill: var(--color-accent-danger-soft);
}

.sparkline__line {
  fill: none;
  stroke: var(--color-accent-primary);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.sparkline__line--negative {
  stroke: var(--color-accent-danger);
}
</style>
