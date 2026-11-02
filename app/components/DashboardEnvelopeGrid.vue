<!--
  DashboardEnvelopeGrid — die oberste Uebersicht des Dashboards: die laufenden
  Ausgaben. Jede Karte bezieht sich auf die eigene, aktuell laufende Periode
  des Umschlags (Woche/Monat/Quartal/Jahr), nicht auf den Kalendermonat.

  2 Karten pro Reihe auf Mobile (Default), mehr auf breiteren Viewports.

  Aus der Karte heraus laesst sich direkt eine Ausgabe fuer GENAU diesen
  Umschlag erfassen: globaler Erfassen-Dialog (useQuickCapture, issue #91) mit
  vorausgewaehltem Umschlag.

  ADR-0005: Die Karte rechnet vom Verfuegbaren zum Saldo, ihre Farbe kommt aus
  der Bewertung nach Saldo — nicht aus dem Vergleich mit der Zuteilung.

  Klick auf die Karte (oberhalb des "Erfassen"-Buttons) oeffnet die
  Detailseite (Saldo + Verlauf sind dort die Hauptansicht).
-->
<script setup lang="ts">
import type { EnvelopeItem } from '~/types/envelope'

defineProps<{
  envelopes: EnvelopeItem[]
  formatMoney: (cents: number) => string
}>()

const quickCapture = useQuickCapture()

function captureExpense(envelopeId: string) {
  quickCapture.open('expense', { envelopeId })
}
</script>

<template>
  <div v-if="envelopes.length === 0" class="empty">
    Noch keine laufenden Ausgaben — lege einen Umschlag an, um den aktuellen Stand zu sehen.
  </div>
  <div v-else class="grid">
    <article v-for="envelope in envelopes" :key="envelope.id" class="card" :class="`card--${envelope.severity}`">
      <NuxtLink :to="`/budgeting/envelopes/${envelope.id}`" class="card__main">
        <div class="card__head">
          <span class="card__name">{{ envelope.name }}</span>
          <span v-if="envelope.currentPeriod" class="card__period">{{ formatEnvelopePeriodLabel(envelope.frequency, envelope.currentPeriod.start, envelope.currentPeriod.end) }}</span>
        </div>
        <div v-if="envelope.currentPeriod" class="card__body">
          <!-- ADR-0005: Der Ring misst die Ausgaben am Verfuegbaren; nichts verfuegbar heisst voll. -->
          <EnvelopePeriodRing :percent="envelope.currentPeriod.percentUsed ?? 100" :severity="envelope.severity" :size="56" class="card__ring" />
          <dl class="card__amounts">
            <div class="card__amount-row">
              <dt class="sr-only">Verfügbar</dt>
              <span class="card__op" aria-hidden="true"></span>
              <dd>{{ formatMoney(envelope.currentPeriod.available) }}</dd>
            </div>
            <div class="card__amount-row">
              <dt class="sr-only">Ausgaben</dt>
              <span class="card__op" aria-hidden="true">−</span>
              <dd>{{ formatMoney(envelope.currentPeriod.spent) }}</dd>
            </div>
            <div class="card__amount-row card__amount-row--saldo" :class="{ 'is-negative': envelope.balance.balance < 0 }">
              <dt class="sr-only">Saldo</dt>
              <span class="card__op" aria-hidden="true">=</span>
              <dd>{{ formatMoney(envelope.balance.balance) }}</dd>
            </div>
          </dl>
        </div>
        <div class="card__balance">
          <span v-if="envelope.reserved > 0" class="card__balance-label">+{{ formatMoney(envelope.reserved) }} kommen bis Monatsende</span>
          <!-- Trend der letzten 3 Monate ueber die volle Kartenbreite (#148);
               Details mit Ereignissen auf der Detailseite. -->
          <EnvelopeBalanceSparkline :values="envelope.balanceTrend" :width="160" :height="22" fluid />
        </div>
      </NuxtLink>
      <button
        type="button"
        class="card__footer"
        :aria-label="`Ausgabe für ${envelope.name} erfassen`"
        @click="captureExpense(envelope.id)"
      >
        <i class="pi pi-plus" aria-hidden="true" />
        <span>Erfassen</span>
      </button>
    </article>
  </div>
</template>

<style scoped>
.card__balance {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.card__balance-label {
  /* Rechtsbuendig wie die Betragsspalte darueber (#148). */
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  padding: 0.5rem 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (min-width: 640px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0.7rem 0.65rem 0;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* Klick-Flaeche der Karte (Kopf + Ring/Zahlen) — verlinkt auf die
   Buchungsliste, gefiltert nach Budget + exakter Perioden-Spanne. Der
   "Erfassen"-Button bleibt bewusst AUSSERHALB dieses Links (eigener
   Klick-Handler direkt darunter). */
.card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  padding-bottom: 0.7rem;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-md);
}

.card__main:hover .card__name {
  color: var(--color-accent-primary-text, #93c5fd);
}

.card__main:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.card--warning {
  border-color: rgba(245, 158, 11, 0.3);
}

.card--over {
  border-color: rgba(239, 68, 68, 0.32);
}

.card__head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  text-align: left;
}

.card__name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.25;
}

.card__period {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.card__body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}

.card__ring {
  flex-shrink: 0;
}

.card__amounts {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.card__amount-row {
  display: flex;
  align-items: baseline;
  gap: 0.15rem;
  line-height: 1.2;
}

.card__op {
  flex-shrink: 0;
  width: 0.65rem;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  font-weight: 700;
  text-align: center;
}

.card__amount-row dd {
  flex: 1 1 auto;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.74rem;
  font-weight: 600;
  text-align: right;
}

.card__amount-row--saldo .card__op,
.card__amount-row--saldo dd {
  color: var(--color-accent-success-text);
}

.card__amount-row--saldo.is-negative .card__op,
.card__amount-row--saldo.is-negative dd {
  color: var(--color-accent-danger-text);
}

.card__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0 -0.65rem;
  padding: 0.45rem 0.5rem;
  border: 0;
  border-top: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-accent-success-text);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}

.card__footer:hover {
  background: var(--color-accent-success-soft);
}

.card__footer:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

.card__footer .pi {
  font-size: 0.7rem;
}
</style>
