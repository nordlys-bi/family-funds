<!--
  BudgetBalanceChart — Stufenlinie des Budgetsaldos (ADR-0004).

  Handgeschriebenes SVG wie BudgetPeriodRing.vue, keine Chart-Library. Die
  Geometrie kommt aus `~/utils/balance-chart` (getestet), hier wird nur
  gezeichnet. Breite folgt dem Container (ResizeObserver) statt eines
  verzerrten viewBox, damit Schrift und Marker auch auf Handybreite
  ihre Groesse behalten.

  Nulllinie betont, Flaeche unter null in Danger-Farbe: "Wann war das
  Budget ueberzogen?" soll ohne Achsenlesen sichtbar sein.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { balanceAxisTicks, buildBalanceChartGeometry, compactMoneyLabel, type BalancePoint } from '~/utils/balance-chart'

export type BalanceChartEvent = {
  type: 'transfer' | 'version' | 'carryover'
  date: string
  /** Beschriftung fuer Tooltip (`<title>`) und Screenreader. */
  label: string
}

const props = withDefaults(
  defineProps<{
    points: BalancePoint[]
    events?: BalanceChartEvent[]
    range: { from: string; to: string }
    formatMoney: (cents: number) => string
    height?: number
  }>(),
  { events: () => [], height: 180 },
)

const PADDING = { top: 10, right: 10, bottom: 22, left: 58 }
/** Haelfte von `stroke-width` der Linie (CSS unten). */
const LINE_HALF_WIDTH = 1

const container = ref<HTMLElement | null>(null)
// SSR/erster Render: plausible Desktop-Breite, der ResizeObserver korrigiert.
const width = ref(600)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!container.value) return
  width.value = container.value.clientWidth || width.value
  observer = new ResizeObserver((entries) => {
    const next = entries[0]?.contentRect.width
    if (next) width.value = next
  })
  observer.observe(container.value)
})

onBeforeUnmount(() => observer?.disconnect())

const geometry = computed(() =>
  buildBalanceChartGeometry({
    points: props.points,
    width: width.value,
    height: props.height,
    padding: PADDING,
    range: props.range,
  }),
)

const ticks = computed(() => balanceAxisTicks(geometry.value.domain))

const uid = useId()
const clipAbove = `${uid}-above`
const clipBelow = `${uid}-below`

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${day}.${month}.`
}

/** Saldo am Ende des Ereignistags — dort sitzt der Marker auf der Linie. */
function balanceOn(date: string) {
  let value = props.points[0]?.balance ?? 0
  for (const point of props.points) {
    if (point.date <= date) value = point.balance
  }
  return value
}

const markers = computed(() =>
  props.events.map((event, index) => ({
    ...event,
    key: `${event.type}-${event.date}-${index}`,
    x: geometry.value.xOfDate(event.date),
    y: geometry.value.yOfValue(balanceOn(event.date)),
  })),
)

const lastPoint = computed(() => props.points.at(-1) ?? null)
const ariaLabel = computed(() => {
  const last = lastPoint.value
  return last
    ? `Saldo-Verlauf ${shortDate(props.range.from)} bis ${shortDate(props.range.to)}, aktuell ${props.formatMoney(last.balance)}`
    : 'Saldo-Verlauf'
})
</script>

<template>
  <div ref="container" class="balance-chart">
    <svg
      :width="geometry.width"
      :height="geometry.height"
      :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
      role="img"
      :aria-label="ariaLabel"
    >
      <defs>
        <!-- Grenze eine halbe Strichbreite unter null: Eine Linie genau auf
             null (z.B. vor Saldo-Start) soll nicht halb rot gezeichnet werden. -->
        <clipPath :id="clipAbove">
          <rect :x="0" :y="0" :width="geometry.width" :height="Math.max(0, geometry.zeroY + LINE_HALF_WIDTH)" />
        </clipPath>
        <clipPath :id="clipBelow">
          <rect
            :x="0"
            :y="geometry.zeroY + LINE_HALF_WIDTH"
            :width="geometry.width"
            :height="Math.max(0, geometry.height - geometry.zeroY - LINE_HALF_WIDTH)"
          />
        </clipPath>
      </defs>

      <!-- Hilfslinien + y-Beschriftung -->
      <g class="balance-chart__grid">
        <template v-for="tick in ticks" :key="tick">
          <line
            v-if="tick !== 0"
            :x1="geometry.plot.left"
            :x2="geometry.plot.right"
            :y1="geometry.yOfValue(tick)"
            :y2="geometry.yOfValue(tick)"
            class="balance-chart__gridline"
          />
          <text
            :x="geometry.plot.left - 6"
            :y="geometry.yOfValue(tick) + 3.5"
            text-anchor="end"
            class="balance-chart__axis-label"
          >{{ compactMoneyLabel(formatMoney(tick)) }}</text>
        </template>
      </g>

      <!-- Flaeche: ueber null dezent, unter null in Danger-Farbe -->
      <path :d="geometry.areaPath" class="balance-chart__area balance-chart__area--positive" :clip-path="`url(#${clipAbove})`" />
      <path :d="geometry.areaPath" class="balance-chart__area balance-chart__area--negative" :clip-path="`url(#${clipBelow})`" />

      <line
        :x1="geometry.plot.left"
        :x2="geometry.plot.right"
        :y1="geometry.zeroY"
        :y2="geometry.zeroY"
        class="balance-chart__zero"
      />

      <path :d="geometry.linePath" class="balance-chart__line" :clip-path="`url(#${clipAbove})`" />
      <path :d="geometry.linePath" class="balance-chart__line balance-chart__line--negative" :clip-path="`url(#${clipBelow})`" />

      <!-- x-Beschriftung: nur Anfang und Ende, mehr passt mobil nicht sauber -->
      <text :x="geometry.plot.left" :y="geometry.height - 6" text-anchor="start" class="balance-chart__axis-label">
        {{ shortDate(range.from) }}
      </text>
      <text :x="geometry.plot.right" :y="geometry.height - 6" text-anchor="end" class="balance-chart__axis-label">
        {{ shortDate(range.to) }}
      </text>

      <g v-for="marker in markers" :key="marker.key" class="balance-chart__marker" :class="`balance-chart__marker--${marker.type}`">
        <title>{{ marker.label }}</title>
        <line :x1="marker.x" :x2="marker.x" :y1="geometry.plot.top" :y2="geometry.plot.bottom" class="balance-chart__marker-rule" />
        <circle :cx="marker.x" :cy="marker.y" r="4.5" class="balance-chart__marker-dot" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.balance-chart {
  width: 100%;
  min-width: 0;
}

.balance-chart svg {
  display: block;
  overflow: visible;
}

.balance-chart__gridline {
  stroke: var(--color-border-subtle);
  stroke-dasharray: 3 3;
}

.balance-chart__axis-label {
  fill: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.balance-chart__zero {
  stroke: var(--color-text-muted);
  stroke-width: 1.5;
}

.balance-chart__area--positive {
  fill: var(--color-accent-primary);
  fill-opacity: 0.12;
}

.balance-chart__area--negative {
  fill: var(--color-accent-danger-soft);
}

.balance-chart__line {
  fill: none;
  stroke: var(--color-accent-primary);
  stroke-width: 2;
  stroke-linejoin: round;
}

.balance-chart__line--negative {
  stroke: var(--color-accent-danger);
}

.balance-chart__marker-rule {
  stroke: var(--color-border-default);
  stroke-dasharray: 2 3;
}

.balance-chart__marker-dot {
  stroke: var(--color-bg-page);
  stroke-width: 1.5;
}

.balance-chart__marker--transfer .balance-chart__marker-dot {
  fill: var(--color-accent-warning);
}

.balance-chart__marker--version .balance-chart__marker-dot {
  fill: var(--color-accent-primary);
}

.balance-chart__marker--carryover .balance-chart__marker-dot {
  fill: var(--color-accent-success);
}
</style>
