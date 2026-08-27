<!--
  DashboardBudgetList — die Budget-Auslastungs-Liste des Dashboards.

  Eigene Komponente, weil im Dashboard mehrere Stellen den gleichen
  "Top-3-Alerts"-Render-Pfad brauchen. Pattern:
  <ListPanel :title="..." :badge="...">
    <template #actions>...</template>
    <DashboardBudgetList :alerts="..." />
  </ListPanel>

  Issue #82: WEEKLY-Budgets kriegen einen Toggle, der die Wochen-Aufschlüsselung
  ein-/ausblendet. Default collapsed (kompaktes Dashboard), Klick aufs Item
  öffnet. Andere Frequenzen zeigen weiterhin nur die Monats-Zeile.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'

type PeriodSeverity = 'ok' | 'warning' | 'over'

type Period = {
  start: string | Date
  end: string | Date
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: PeriodSeverity
}

type Alert = {
  budgetId: string
  name: string
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: 'ok' | 'warning' | 'over'
  currentFrequency?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE' | null
  periods?: Period[]
}

const props = defineProps<{
  alerts: Alert[]
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
  /**
   * Default-Verhalten für den Wochen-Toggle. Auf dem Dashboard
   * collapsed, auf der Detail-Page (/budgeting/budgets) expanded
   * (Detail-Kontext → Whitespace ist hier ok).
   */
  defaultExpanded?: boolean
}>()

// Set<string> mit budgetIds, die aktuell aufgeklappt sind. Lokaler
// Component-State, kein Pinia/Persist nötig — Toggle-Status ist
// Session-lokal.
const expandedIds = ref<Set<string>>(new Set())

function isExpanded(budgetId: string): boolean {
  if (props.defaultExpanded) return true
  return expandedIds.value.has(budgetId)
}

function toggle(budgetId: string): void {
  if (props.defaultExpanded) return // Detail-Page: Toggle deaktiviert
  const next = new Set(expandedIds.value)
  if (next.has(budgetId)) {
    next.delete(budgetId)
  } else {
    next.add(budgetId)
  }
  expandedIds.value = next
}

const hasWeekly = computed(() => props.alerts.some((a) => a.currentFrequency === 'WEEKLY' && (a.periods?.length ?? 0) > 0))

// === Wochen-Label ===================================================
// "KW 34 (18.–24. Aug)" — ISO-Kalenderwoche + Datums-Range der Woche.
// Locale "de-DE" liefert "Aug."-Abkürzung passend zur Monats-Summe.
const weekFormatter = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })
const weekDayFormatter = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })

function formatWeekday(date: Date | string): string {
  return weekDayFormatter.format(new Date(date))
}

function isoWeekNumber(date: Date): number {
  // ISO 8601 — Donnerstag der Woche bestimmt die KW.
  // Kopie der Date, Donnerstag der aktuellen Woche finden.
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  // Donnerstag der aktuellen Woche: Montag + 3 Tage
  const dayNum = (target.getDay() + 6) % 7 // Mo = 0, So = 6
  target.setDate(target.getDate() - dayNum + 3)
  // Erster Donnerstag des Jahres
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

function periodLabel(period: Period): string {
  const start = new Date(period.start)
  const end = new Date(period.end)
  // end ist exklusiv (start + 7d) — für die Anzeige einen Tag abziehen.
  const endDisplay = new Date(end)
  endDisplay.setDate(endDisplay.getDate() - 1)
  const kw = isoWeekNumber(start)
  const startStr = weekFormatter.format(start).replace(/\./g, '').trim()
  const endStr = weekDayFormatter.format(endDisplay).replace(/\./g, '').trim()
  return `KW ${kw} (${startStr}–${endStr})`
}

void formatWeekday
</script>

<template>
  <div v-if="alerts.length === 0" class="empty">
    Noch keine Budgets — Budgets helfen, geplante Ausgaben im Auge zu behalten.
  </div>
  <ul v-else class="list">
    <li v-for="alert in alerts" :key="alert.budgetId" class="item">
      <button
        type="button"
        class="head"
        :class="{ 'head--clickable': alert.currentFrequency === 'WEEKLY' && (alert.periods?.length ?? 0) > 0 }"
        :aria-expanded="alert.currentFrequency === 'WEEKLY' ? isExpanded(alert.budgetId) : undefined"
        :disabled="alert.currentFrequency !== 'WEEKLY' || (alert.periods?.length ?? 0) === 0"
        @click="toggle(alert.budgetId)"
      >
        <span class="name">{{ alert.name }}</span>
        <span class="pct" :class="`pct--${alert.severity}`">
          {{ alert.percentUsed.toFixed(0) }}%
        </span>
        <span
          v-if="alert.currentFrequency === 'WEEKLY' && (alert.periods?.length ?? 0) > 0"
          class="chevron"
          :class="{ 'chevron--open': isExpanded(alert.budgetId) }"
          aria-hidden="true"
        >▾</span>
      </button>
      <ListProgressBar :percent="alert.percentUsed" :tone="alert.severity" />
      <div class="meta">
        {{ formatMoney(alert.spentAmount) }} von {{ formatMoney(alert.plannedAmount) }}
        · noch {{ formatMoney(alert.remainingAmount) }}
      </div>

      <!-- Issue #82: Wochen-Aufschlüsselung (nur WEEKLY-Budgets). -->
      <ul
        v-if="alert.currentFrequency === 'WEEKLY' && isExpanded(alert.budgetId) && (alert.periods?.length ?? 0) > 0"
        class="periods"
      >
        <li
          v-for="(period, periodIndex) in alert.periods"
          :key="`${alert.budgetId}-period-${periodIndex}`"
          class="period"
        >
          <div class="period__head">
            <span class="period__label">{{ periodLabel(period) }}</span>
            <span class="pct" :class="`pct--${period.severity}`">
              {{ period.percentUsed.toFixed(0) }}%
            </span>
          </div>
          <ListProgressBar :percent="period.percentUsed" :tone="period.severity" />
          <div class="period__meta">
            {{ formatMoney(period.spentAmount) }} von {{ formatMoney(period.plannedAmount) }}
            · noch {{ formatMoney(period.remainingAmount) }}
          </div>
        </li>
      </ul>
    </li>
  </ul>
  <div v-if="hasWeekly" class="footer-hint" aria-hidden="true">
    Klick aufs Budget zeigt die einzelnen Wochen
  </div>
</template>

<style scoped>
.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  padding: 0.5rem 0;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: default;
  width: 100%;
}

.head--clickable {
  cursor: pointer;
}

.head--clickable:hover .name {
  color: #f1f5f9;
}

.head:focus-visible {
  outline: 2px solid rgba(96, 165, 250, 0.6);
  outline-offset: 2px;
  border-radius: 4px;
}

.head:disabled {
  cursor: default;
}

.name {
  font-weight: 600;
  font-size: 0.95rem;
  flex: 1 1 auto;
  min-width: 0;
}

.pct {
  font-weight: 600;
  font-size: 0.85rem;
}

.pct--ok {
  color: var(--color-text-secondary);
}
.pct--warning {
  color: var(--color-accent-warning-text);
}
.pct--over {
  color: var(--color-accent-danger-text);
}

.meta {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.chevron {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.chevron--open {
  transform: rotate(180deg);
}

.periods {
  list-style: none;
  padding: 0.6rem 0 0.2rem 0.85rem;
  margin: 0.4rem 0 0;
  border-left: 2px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.period {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.period__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.period__label {
  font-size: 0.82rem;
  font-weight: 500;
  color: #cbd5e1;
}

.period__meta {
  font-size: 0.74rem;
  color: var(--color-text-muted);
}

.footer-hint {
  margin-top: 0.6rem;
  font-size: 0.74rem;
  color: var(--color-text-muted);
  text-align: center;
  font-style: italic;
}
</style>