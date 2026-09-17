<!--
  DashboardBudgetPeriodGrid — die neue "oberste Prio"-Budget-Uebersicht des
  Dashboards. Ersetzt die alte, kalendermonats-skalierte
  DashboardBudgetList: jede Karte bezieht sich auf die eigene, aktuell
  laufende Periode des Budgets (Woche/Monat/Quartal/Jahr/einmalig), nicht
  auf den Kalendermonat — siehe `getCurrentBudgetPeriodWindows` in
  `server/utils/budget-evaluation.ts` fuer die Begruendung.

  2 Karten pro Reihe auf Mobile (Default), mehr auf breiteren Viewports.

  Issue-Request: aus der Karte heraus direkt eine Ausgabe fuer GENAU
  dieses Budget erfassen koennen. Nutzt den globalen Erfassen-Dialog
  (useQuickCapture, issue #91) mit vorausgewaehltem Budget — kein
  eigener Dialog noetig.

  Issue-Request: Klick auf die Karte (oberhalb des "Erfassen"-Buttons)
  oeffnet die Buchungsliste, gefiltert nach genau diesem Budget UND der
  exakten Perioden-Spanne (nicht dem Kalendermonat) — siehe
  `?from&to`-Support in `server/api/households/[householdId]/transactions.get.ts`.
-->
<script setup lang="ts">
import type { Frequency } from '~/types/planning'

type PeriodCard = {
  budgetId: string
  key: string
  name: string
  frequency: Frequency
  periodStart: string
  periodEnd: string | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: 'ok' | 'warning' | 'over'
}

defineProps<{
  cards: PeriodCard[]
  formatMoney: (cents: number) => string
}>()

const quickCapture = useQuickCapture()

function captureExpense(budgetId: string) {
  quickCapture.open('expense', { budgetId })
}

function transactionsLink(card: PeriodCard) {
  return {
    path: '/transactions/expenses',
    query: {
      budgetId: card.budgetId,
      from: card.periodStart,
      ...(card.periodEnd ? { to: card.periodEnd } : {}),
    },
  }
}
</script>

<template>
  <div v-if="cards.length === 0" class="empty">
    Noch keine aktiven Budgets — lege ein Budget an, um den aktuellen Stand zu sehen.
  </div>
  <div v-else class="grid">
    <article v-for="card in cards" :key="card.budgetId" class="card" :class="`card--${card.severity}`">
      <NuxtLink :to="transactionsLink(card)" class="card__main">
        <div class="card__head">
          <span class="card__name">{{ card.name }}</span>
          <span class="card__period">{{ formatBudgetPeriodLabel(card.frequency, card.periodStart, card.periodEnd) }}</span>
        </div>
        <div class="card__body">
          <BudgetPeriodRing :percent="card.percentUsed" :severity="card.severity" :size="56" class="card__ring" />
          <dl class="card__amounts">
            <div class="card__amount-row">
              <dt class="sr-only">Budget</dt>
              <span class="card__op" aria-hidden="true"></span>
              <dd>{{ formatMoney(card.plannedAmount) }}</dd>
            </div>
            <div class="card__amount-row">
              <dt class="sr-only">Ausgaben</dt>
              <span class="card__op" aria-hidden="true">−</span>
              <dd>{{ formatMoney(card.spentAmount) }}</dd>
            </div>
            <div class="card__amount-row card__amount-row--saldo" :class="{ 'is-negative': card.remainingAmount < 0 }">
              <dt class="sr-only">Saldo</dt>
              <span class="card__op" aria-hidden="true">=</span>
              <dd>{{ formatMoney(card.remainingAmount) }}</dd>
            </div>
          </dl>
        </div>
      </NuxtLink>
      <button
        type="button"
        class="card__footer"
        :aria-label="`Ausgabe für ${card.name} erfassen`"
        @click="captureExpense(card.budgetId)"
      >
        <i class="pi pi-plus" aria-hidden="true" />
        <span>Erfassen</span>
      </button>
    </article>
  </div>
</template>

<style scoped>
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
