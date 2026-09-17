<!--
  SwipeableListItem — Wrapper fuer eine Swipe-Geste auf mobilen Listen-
  Karten: Wischen nach RECHTS emittiert `swipe-right`, Wischen nach
  LINKS emittiert `swipe-left` (Ausgaben/Einnahmen: rechts = Bearbeiten,
  links = Loeschen).

  Aus Konsumenten-Sicht zaehlt nur die Wisch-RICHTUNG (swipe-left /
  swipe-right); dass die zugehoerige Farb-/Icon-Flaeche dabei am jeweils
  ANDEREN Kartenrand sichtbar wird (Wischen nach rechts schiebt die Karte
  nach rechts und deckt damit die linke Kante auf), ist reines
  Implementierungsdetail dieser Komponente.

  Nutzt Pointer Events (nicht Touch Events), damit dieselbe Logik auch
  mit der Maus funktioniert (Trackpad, Browser-Tests). `touch-action:
  pan-y` auf dem Inhalt erlaubt weiterhin vertikales Seiten-Scrollen —
  erst wenn eine Geste eindeutig horizontal ist (mehr X- als Y-Bewegung
  nach ein paar Pixeln), uebernimmt der Swipe die Kontrolle.

  Der bestehende Tap-oeffnet-Menu-Handler auf dem Slot-Inhalt bleibt
  unangetastet: ein Klick nach einem (auch abgebrochenen) horizontalen
  Swipe wird per Capture-Listener unterdrueckt, ein normaler Tap ohne
  Bewegung feuert wie gewohnt durch.

  Verwendung:
    <SwipeableListItem
      swipe-right-icon="pi pi-pen-to-square" swipe-right-label="Bearbeiten"
      swipe-left-icon="pi pi-trash" swipe-left-label="Löschen" swipe-left-severity="danger"
      @swipe-right="startInlineEdit(transaction.id)"
      @swipe-left="deleteTransaction(transaction)"
    >
      <div class="card-content" @click="...">...</div>
    </SwipeableListItem>
-->
<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    swipeRightIcon?: string
    swipeRightLabel?: string
    swipeRightSeverity?: 'primary' | 'success' | 'secondary'
    swipeLeftIcon?: string
    swipeLeftLabel?: string
    swipeLeftSeverity?: 'danger' | 'warning'
    /** Ab wieviel Pixel Verschiebung eine Geste als "vollzogen" zaehlt. */
    threshold?: number
  }>(),
  {
    swipeRightSeverity: 'primary',
    swipeLeftSeverity: 'danger',
    threshold: 76,
  },
)

const emit = defineEmits<{
  'swipe-left': []
  'swipe-right': []
}>()

const offset = ref(0)
const animating = ref(false)

const MOVE_LOCK_THRESHOLD = 8
const MAX_OVERDRAG = 40

let pointerId: number | null = null
let startX = 0
let startY = 0
let lockedAxis: 'x' | 'y' | null = null
let didHorizontalDrag = false

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  lockedAxis = null
  animating.value = false
}

function onPointerMove(event: PointerEvent) {
  if (pointerId === null || event.pointerId !== pointerId) return
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY

  if (lockedAxis === null) {
    if (Math.abs(deltaX) < MOVE_LOCK_THRESHOLD && Math.abs(deltaY) < MOVE_LOCK_THRESHOLD) {
      return
    }
    lockedAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
    if (lockedAxis === 'x') {
      didHorizontalDrag = true
      try {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      } catch {
        // Manche Browser/synthetische Events erlauben kein Capture fuer
        // diese pointerId — der Swipe funktioniert trotzdem, nur ohne
        // die Garantie, dass Move-Events ausserhalb des Elements noch
        // ankommen (in der Praxis unkritisch, da wir eh am Element bleiben).
      }
    }
  }

  if (lockedAxis !== 'x') return

  event.preventDefault()
  const maxReveal = props.threshold + MAX_OVERDRAG
  offset.value = Math.max(-maxReveal, Math.min(maxReveal, deltaX))
}

function endDrag(event: PointerEvent) {
  if (pointerId === null || event.pointerId !== pointerId) return
  const finalOffset = offset.value
  const wasHorizontalDrag = lockedAxis === 'x'
  pointerId = null
  lockedAxis = null

  if (!wasHorizontalDrag) {
    offset.value = 0
    return
  }

  animating.value = true
  offset.value = 0
  if (finalOffset <= -props.threshold) {
    emit('swipe-left')
  } else if (finalOffset >= props.threshold) {
    emit('swipe-right')
  }
}

// Unterdrueckt den Klick, der nach einem (auch abgebrochenen) horizontalen
// Swipe sonst zusaetzlich auf dem Slot-Inhalt feuern wuerde (oeffnet sonst
// obendrauf noch das Options-Menu). Capture-Phase, damit es VOR dem
// Bubble-Handler auf dem Slot-Inhalt greift.
function onClickCapture(event: MouseEvent) {
  if (didHorizontalDrag) {
    event.stopPropagation()
    event.preventDefault()
    didHorizontalDrag = false
  }
}
</script>

<template>
  <div class="swipeable">
    <div
      v-if="offset > 0 && swipeRightLabel"
      class="swipeable__action swipeable__action--start"
      :class="`swipeable__action--${swipeRightSeverity}`"
      aria-hidden="true"
    >
      <i :class="swipeRightIcon" />
      <span>{{ swipeRightLabel }}</span>
    </div>
    <div
      v-if="offset < 0 && swipeLeftLabel"
      class="swipeable__action swipeable__action--end"
      :class="`swipeable__action--${swipeLeftSeverity}`"
      aria-hidden="true"
    >
      <span>{{ swipeLeftLabel }}</span>
      <i :class="swipeLeftIcon" />
    </div>
    <div
      class="swipeable__content"
      :class="{ 'swipeable__content--animating': animating }"
      :style="{ transform: offset ? `translateX(${offset}px)` : undefined }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @click.capture="onClickCapture"
      @transitionend="animating = false"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.swipeable {
  position: relative;
  overflow: hidden;
  border-radius: inherit;
}

.swipeable__content {
  position: relative;
  touch-action: pan-y;
  border-radius: inherit;
  /*
   * Muss UNDURCHSICHTIG sein: das ist die Vordergrund-Flaeche, die beim
   * Wischen den Action-Panel darunter (.swipeable__action) freigibt.
   * --color-bg-page ist eine flache, deckende Farbe (keine Transparenz)
   * und macht die Reihe optisch unsichtbar (kein Karten-Look mehr).
   */
  background: var(--color-bg-page);
}

/* Hover-Farbe (siehe ListTable.vue .data-table__card:hover) laeuft
   normalerweise auf .data-table__card — die liegt aber unsichtbar UNTER
   dieser deckenden Flaeche, deshalb hier gespiegelt. --bg-card-row-hover
   ist selbst nicht ganz deckend, deshalb als Toenung ueber einer
   garantiert deckenden Seiten-Grundfarbe (gleiche Technik wie vorher,
   nur mit flacherer Grundfarbe statt Karten-Toenung im Ruhezustand). */
.swipeable__content:hover {
  background:
    linear-gradient(var(--bg-card-row-hover), var(--bg-card-row-hover)),
    var(--color-bg-page);
}

.swipeable__content--animating {
  transition: transform 0.2s ease;
}

.swipeable__action {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 22px;
  font-weight: 600;
  font-size: 0.85rem;
}

.swipeable__action--start {
  justify-content: flex-start;
}

.swipeable__action--end {
  justify-content: flex-end;
}

.swipeable__action--primary {
  background: var(--color-accent-primary);
  color: var(--color-text-on-action);
}

.swipeable__action--success {
  background: var(--color-accent-success);
  color: var(--color-text-on-action);
}

.swipeable__action--secondary {
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
}

.swipeable__action--danger {
  background: var(--color-accent-danger);
  color: var(--color-text-on-action);
}

.swipeable__action--warning {
  background: var(--color-accent-warning);
  color: var(--color-text-on-action);
}
</style>
