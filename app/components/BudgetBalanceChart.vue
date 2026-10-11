<!--
  BudgetBalanceChart — Stufenlinie des Budgetsaldos (ADR-0004).

  Handgeschriebenes SVG wie BudgetPeriodRing.vue, keine Chart-Library. Die
  Geometrie kommt aus `~/utils/balance-chart` (getestet), hier wird nur
  gezeichnet. Breite folgt dem Container (ResizeObserver) statt eines
  verzerrten viewBox, damit Schrift und Marker auch auf Handybreite
  ihre Groesse behalten.

  Nulllinie betont, Flaeche unter null in Danger-Farbe: "Wann war das
  Budget ueberzogen?" soll ohne Achsenlesen sichtbar sein.

  Bedienung (UX-Review nach #145): Handy zuerst, also kein Hover-Tooltip,
  sondern Scrubbing ueber eine transparente Flaeche, die auf den naechsten
  Punkt einrastet (Linie + Blase). `touch-action: pan-y`, damit senkrechtes
  Wischen weiter die Seite scrollt. Marker haben unsichtbare Trefferkreise
  (r=16), die 9-px-Punkte allein waeren mit dem Finger kaum zu treffen.
  Tastatur: Pfeiltasten wandern von Punkt zu Punkt, Enter waehlt. Fuer
  Screenreader steht die Kurve zusaetzlich als Satz in einer
  `.sr-only`-Zusammenfassung (aria-describedby).

  x-Achse: dezente Linie an jedem Periodenbeginn (Montag bzw. Monatserster
  usw.), damit sich jeder Zuteilungssprung einer Periode zuordnen laesst;
  beschriftet nur so viele, wie in die Breite passen.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { balanceAxisTicks, buildBalanceChartGeometry, compactMoneyLabel, type BalancePoint } from '~/utils/balance-chart'
import { nearestIndex, periodTicks, summarizeBalanceHistory } from '~/utils/budget-detail'
import type { Frequency } from '~/types/planning'

export type BalanceChartEvent = {
  type: 'transfer' | 'version' | 'carryover'
  date: string
  /** Beschriftung ohne Datum — fuer Blase, Tooltip (`<title>`) und Screenreader. */
  label: string
}

const props = defineProps<{
  points: BalancePoint[]
  events?: BalanceChartEvent[]
  range: { from: string; to: string }
  formatMoney: (cents: number) => string
  /** Periodenraster des Budgets fuer die x-Achsen-Ticks; ohne: nur Start/Ende. */
  frequency?: Frequency
  /** Fest vorgegebene Hoehe; ohne: 180 px auf Handybreite, sonst 240 px. */
  height?: number
}>()

const emit = defineEmits<{
  /** Punkt angetippt/mit Enter gewaehlt — die Seite springt zur Ereignisliste. */
  select: [date: string]
}>()

const PADDING = { top: 10, right: 10, bottom: 22, left: 58 }
/** Haelfte von `stroke-width` der Linie (CSS unten). */
const LINE_HALF_WIDTH = 1
/** Unterhalb dieser Breite gilt die Handy-Hoehe. */
const NARROW_WIDTH = 640

const container = ref<HTMLElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)
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

const chartHeight = computed(() => props.height ?? (width.value < NARROW_WIDTH ? 180 : 240))
const events = computed(() => props.events ?? [])

const geometry = computed(() =>
  buildBalanceChartGeometry({
    points: props.points,
    width: width.value,
    height: chartHeight.value,
    padding: PADDING,
    range: props.range,
  }),
)

const ticks = computed(() => balanceAxisTicks(geometry.value.domain))

/** Platz pro Beschriftung "21.09." bei 11 px inkl. Luft. */
const X_LABEL_SPACE = 52
/**
 * Mindestabstand einer Periodenbeschriftung zum Plot-Rand: Start-/End-Label
 * sind dort buendig ausgerichtet (volle Breite ~36 px) plus halbe Breite des
 * mittig gesetzten Tick-Labels und etwas Luft.
 */
const EDGE_LABEL_SPACE = 64
/** Linien dichter als das waeren nur noch eine graue Flaeche. */
const MIN_LINE_GAP = 6

const xTicks = computed(() => {
  if (!props.frequency) return []
  const { plot } = geometry.value
  const all = periodTicks(props.range.from, props.range.to, props.frequency, Math.floor((plot.right - plot.left) / X_LABEL_SPACE))
    .map((tick) => ({ ...tick, x: geometry.value.xOfDate(tick.date) }))
  const gap = all.length > 1 ? all[1]!.x - all[0]!.x : Infinity
  return all
    .filter((tick) => gap >= MIN_LINE_GAP || tick.labeled)
    // Start/Ende sind immer beschriftet — Periodenlabels daneben wuerden ueberlappen.
    .map((tick) => ({
      ...tick,
      labeled: tick.labeled && tick.x - plot.left >= EDGE_LABEL_SPACE && plot.right - tick.x >= EDGE_LABEL_SPACE,
    }))
})

const uid = useId()
const clipAbove = `${uid}-above`
const clipBelow = `${uid}-below`
const summaryId = `${uid}-summary`

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${day}.${month}.`
}

function longDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

/** Letzter Punkt eines Tages — sein Saldo ist der Stand am Tagesende. */
function pointIndexOn(date: string) {
  let index = -1
  props.points.forEach((point, candidate) => {
    if (point.date <= date) index = candidate
  })
  return Math.max(0, index)
}

const markers = computed(() =>
  events.value.map((event, index) => {
    const pointIndex = pointIndexOn(event.date)
    return {
      ...event,
      key: `${event.type}-${event.date}-${index}`,
      pointIndex,
      x: geometry.value.xOfDate(event.date),
      y: geometry.value.coords[pointIndex]?.y ?? geometry.value.zeroY,
    }
  }),
)

// === Scrubbing ==========================================================
const activeIndex = ref<number | null>(null)
const activePoint = computed(() => (activeIndex.value === null ? null : props.points[activeIndex.value] ?? null))
const activeCoord = computed(() => (activeIndex.value === null ? null : geometry.value.coords[activeIndex.value] ?? null))
const activeEvents = computed(() =>
  activePoint.value ? events.value.filter((event) => event.date === activePoint.value!.date) : [],
)
const activeText = computed(() => {
  const point = activePoint.value
  if (!point) return ''
  const extra = activeEvents.value.map((event) => event.label).join(', ')
  return `${longDate(point.date)}: ${props.formatMoney(point.balance)}${extra ? ` – ${extra}` : ''}`
})

// Blase nicht ueber den Rand schieben: links/rechts am Rand anschlagen,
// sonst mittig ueber der Linie.
const bubblePlacement = computed(() => {
  const coord = activeCoord.value
  if (!coord) return { style: {}, align: 'center' }
  if (coord.x < width.value * 0.3) return { style: { left: `${Math.max(0, coord.x - 12)}px` }, align: 'start' }
  if (coord.x > width.value * 0.7) return { style: { right: `${Math.max(0, width.value - coord.x - 12)}px` }, align: 'end' }
  return { style: { left: `${coord.x}px` }, align: 'center' }
})

function indexAtClientX(clientX: number) {
  const left = svgEl.value?.getBoundingClientRect().left ?? 0
  return nearestIndex(geometry.value.coords.map((coord) => coord.x), clientX - left)
}

function onPointerMove(event: PointerEvent) {
  const index = indexAtClientX(event.clientX)
  if (index >= 0) activeIndex.value = index
}

function onPointerLeave(event: PointerEvent) {
  // Touch: Blase stehen lassen, bis woanders getippt wird — sonst
  // verschwindet sie genau in dem Moment, in dem man sie lesen will.
  if (event.pointerType === 'mouse') activeIndex.value = null
}

function selectActive() {
  if (activePoint.value) emit('select', activePoint.value.date)
}

function onPlotClick(event: MouseEvent) {
  const index = indexAtClientX(event.clientX)
  if (index < 0) return
  activeIndex.value = index
  selectActive()
}

function onMarkerActivate(pointIndex: number) {
  activeIndex.value = pointIndex
  selectActive()
}

function onKeydown(event: KeyboardEvent) {
  const last = props.points.length - 1
  if (last < 0) return
  const current = activeIndex.value
  let next: number | null = current
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = current === null ? last : Math.min(last, current + 1)
      break
    case 'ArrowLeft':
    case 'ArrowDown':
      next = current === null ? last : Math.max(0, current - 1)
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      selectActive()
      return
    case 'Escape':
      activeIndex.value = null
      return
    default:
      return
  }
  event.preventDefault()
  activeIndex.value = next
}

function onBlur() {
  activeIndex.value = null
}

// === Screenreader ======================================================
const ariaLabel = computed(() =>
  `Saldo-Verlauf vom ${longDate(props.range.from)} bis ${longDate(props.range.to)} – Pfeiltasten wandern durch die Punkte, Enter springt zum Ereignis`,
)

const summaryText = computed(() => {
  const summary = summarizeBalanceHistory(props.points)
  if (!summary) return ''
  const negative = summary.daysNegative === 0
    ? 'Kein Tag im Minus.'
    : summary.daysNegative === 1 ? '1 Tag im Minus.' : `${summary.daysNegative} Tage im Minus.`
  return [
    `Start ${props.formatMoney(summary.start)} am ${longDate(props.range.from)},`,
    `Ende ${props.formatMoney(summary.end)} am ${longDate(props.range.to)}.`,
    `Tiefster Stand ${props.formatMoney(summary.min.balance)} am ${longDate(summary.min.date)}.`,
    negative,
  ].join(' ')
})
</script>

<template>
  <div
    ref="container"
    class="balance-chart"
    tabindex="0"
    role="group"
    aria-roledescription="Diagramm"
    :aria-label="ariaLabel"
    :aria-describedby="summaryId"
    @keydown="onKeydown"
    @blur="onBlur"
  >
    <p :id="summaryId" class="sr-only">{{ summaryText }}</p>
    <p class="sr-only" aria-live="polite">{{ activeText }}</p>

    <div
      v-if="activePoint"
      class="balance-chart__bubble"
      :class="`balance-chart__bubble--${bubblePlacement.align}`"
      :style="bubblePlacement.style"
      aria-hidden="true"
    >
      <span class="balance-chart__bubble-date">{{ longDate(activePoint.date) }}</span>
      <strong class="balance-chart__bubble-value" :class="{ 'is-negative': activePoint.balance < 0 }">
        {{ formatMoney(activePoint.balance) }}
      </strong>
      <span v-for="event in activeEvents" :key="`${event.type}-${event.label}`" class="balance-chart__bubble-event">
        {{ event.label }}
      </span>
    </div>

    <svg
      ref="svgEl"
      :width="geometry.width"
      :height="geometry.height"
      :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
      aria-hidden="true"
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
            :y="geometry.yOfValue(tick) + 4"
            text-anchor="end"
            class="balance-chart__axis-label"
          >{{ compactMoneyLabel(formatMoney(tick)) }}</text>
        </template>
      </g>

      <!-- Periodengrenzen: hinter Flaeche und Linie; Linie immer, Beschriftung ausgeduennt -->
      <g class="balance-chart__period-ticks">
        <template v-for="tick in xTicks" :key="tick.date">
          <line :x1="tick.x" :x2="tick.x" :y1="geometry.plot.top" :y2="geometry.plot.bottom" class="balance-chart__period-line" />
          <text
            v-if="tick.labeled"
            :x="tick.x"
            :y="geometry.height - 6"
            text-anchor="middle"
            class="balance-chart__axis-label"
          >{{ shortDate(tick.date) }}</text>
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

      <!-- x-Beschriftung Anfang und Ende -->
      <text :x="geometry.plot.left" :y="geometry.height - 6" text-anchor="start" class="balance-chart__axis-label">
        {{ shortDate(range.from) }}
      </text>
      <text :x="geometry.plot.right" :y="geometry.height - 6" text-anchor="end" class="balance-chart__axis-label">
        {{ shortDate(range.to) }}
      </text>

      <g v-for="marker in markers" :key="marker.key" class="balance-chart__marker" :class="`balance-chart__marker--${marker.type}`">
        <line :x1="marker.x" :x2="marker.x" :y1="geometry.plot.top" :y2="geometry.plot.bottom" class="balance-chart__marker-rule" />
        <circle :cx="marker.x" :cy="marker.y" r="4.5" class="balance-chart__marker-dot" />
      </g>

      <!-- Scrub-Linie + Punkt -->
      <g v-if="activeCoord" class="balance-chart__active">
        <line :x1="activeCoord.x" :x2="activeCoord.x" :y1="geometry.plot.top" :y2="geometry.plot.bottom" class="balance-chart__active-rule" />
        <circle :cx="activeCoord.x" :cy="activeCoord.y" r="5" class="balance-chart__active-dot" />
      </g>

      <!-- Bedienflaeche ueber dem ganzen Plot, darueber die Trefferkreise der Marker -->
      <rect
        :x="Math.max(0, geometry.plot.left - 12)"
        :y="0"
        :width="geometry.plot.right - geometry.plot.left + 24"
        :height="geometry.height"
        class="balance-chart__hit-area"
        @pointerdown="onPointerMove"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
        @click="onPlotClick"
      />
      <circle
        v-for="marker in markers"
        :key="`hit-${marker.key}`"
        :cx="marker.x"
        :cy="marker.y"
        r="16"
        class="balance-chart__hit-area"
        @pointerdown="activeIndex = marker.pointIndex"
        @pointermove="activeIndex = marker.pointIndex"
        @pointerleave="onPointerLeave"
        @click.stop="onMarkerActivate(marker.pointIndex)"
      >
        <title>{{ shortDate(marker.date) }} {{ marker.label }}</title>
      </circle>
    </svg>
  </div>
</template>

<style scoped>
.balance-chart {
  position: relative;
  width: 100%;
  min-width: 0;
  border-radius: var(--radius-sm);
}

.balance-chart:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 4px;
}

.balance-chart svg {
  display: block;
  overflow: visible;
}

.balance-chart__gridline {
  stroke: var(--color-border-subtle);
  stroke-dasharray: 3 3;
}

.balance-chart__period-line {
  stroke: var(--color-border-subtle);
}

.balance-chart__axis-label {
  fill: var(--color-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.balance-chart__zero {
  stroke: var(--color-text-muted);
  stroke-width: 1.5;
}

.balance-chart__area--positive {
  fill: var(--color-accent-primary-soft);
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

/* Ring in Panel-Farbe trennt den Punkt von der Linie, auf der er sitzt. */
.balance-chart__marker-dot {
  stroke: var(--color-bg-panel-solid);
  stroke-width: 2;
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

.balance-chart__active-rule {
  stroke: var(--color-text-muted);
  stroke-width: 1;
}

.balance-chart__active-dot {
  fill: var(--color-text-primary);
  stroke: var(--color-bg-panel-solid);
  stroke-width: 2;
}

.balance-chart__hit-area {
  fill: transparent;
  cursor: crosshair;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}

.balance-chart__bubble {
  position: absolute;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: min(16rem, 80%);
  padding: 0.3rem 0.55rem;
  background: var(--color-bg-modal);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  font-size: 0.75rem;
  line-height: 1.3;
  pointer-events: none;
  transform: translateY(calc(-100% - 6px));
}

.balance-chart__bubble--center {
  transform: translate(-50%, calc(-100% - 6px));
}

.balance-chart__bubble-date {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.balance-chart__bubble-value {
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.balance-chart__bubble-value.is-negative {
  color: var(--color-accent-danger-text);
}

.balance-chart__bubble-event {
  color: var(--color-text-secondary);
}
</style>
