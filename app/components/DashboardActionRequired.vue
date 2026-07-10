<!--
  DashboardActionRequired — der "Handlungsbedarf"-Block des Dashboards.

  Issue #37: oberste Frage des Alltags ist "Was muss ich mir ansehen?",
  nicht "Wie hoch waren meine Einnahmen?". Diese Sektion beantwortet
  genau das, in der Reihenfolge der Wichtigkeit:

  1. Kritische Budgets (severity warning/over) — direkter Handlungsbedarf
  2. Buchungen ohne Budget-Zuordnung — User muss entscheiden
  3. Letzte Buchung — Schnellzugriff / Kontext
  4. Freies Restbudget — informativ, am unteren Rand

  Wenn keines der Felder Daten hat, zeigen wir einen ruhigen Empty-State
  ("Alles im grünen Bereich"). Kein Alarm-Sound, keine rote Karte
  ohne Inhalt.
-->
<script setup lang="ts">
const props = defineProps<{
  budgetAlerts: Array<{
    budgetId: string
    name: string
    plannedAmount: number
    spentAmount: number
    remainingAmount: number
    percentUsed: number
    severity: 'ok' | 'warning' | 'over'
  }>
  unassignedExpenses: number
  recentActivity: Array<{
    id: string
    kind: 'expense' | 'income'
    amount: number
    description: string | null
    date: string
    budgetName: string | null
    userDisplayName: string | null
  }>
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
}>()

// Kritisch = warning oder over. "ok" ist der Normalzustand.
const criticalBudgets = computed(() =>
  props.budgetAlerts.filter((alert) => alert.severity !== 'ok'),
)

// Summe der remainingAmount ueber alle "ok"-Budgets.
const freeBudgetTotal = computed(() =>
  props.budgetAlerts
    .filter((alert) => alert.severity === 'ok')
    .reduce((sum, alert) => sum + alert.remainingAmount, 0),
)

// Nur die neueste Buchung fuer den Schnellzugriff. Der vollstaendige
// Verlauf bleibt weiter unten im "Letzte Buchungen"-Panel.
const latestEntry = computed(() => props.recentActivity[0] ?? null)

// Welche Items zeigen wir im Block? Ein Item gilt als "aktiv", wenn es
// entweder ueberhaupt Daten hat oder eine sinnvolle Aussage machen kann.
const hasCritical = computed(() => criticalBudgets.value.length > 0)
const hasUnassigned = computed(() => props.unassignedExpenses > 0)
const hasLatest = computed(() => latestEntry.value !== null)
const hasFreeBudget = computed(() => freeBudgetTotal.value > 0)

const isAllClear = computed(
  () => !hasCritical.value && !hasUnassigned.value && !hasLatest.value,
)

// Anzahl der ueber-Critical-Budgets (severity === 'over') fuer die Ampel-Label.
const overBudgetCount = computed(
  () => criticalBudgets.value.filter((alert) => alert.severity === 'over').length,
)
</script>

<template>
  <section class="action-required" aria-label="Handlungsbedarf">
    <header class="action-required__head">
      <h2 class="action-required__title">Handlungsbedarf</h2>
      <span v-if="criticalBudgets.length > 0" class="action-required__count" :class="overBudgetCount > 0 ? 'action-required__count--over' : 'action-required__count--warning'">
        {{ criticalBudgets.length }} kritisch{{ criticalBudgets.length === 1 ? '' : 'e' }}
      </span>
    </header>

    <!-- Empty-State: alles ruhig. Kein rotes Banner, einfach gruen. -->
    <div v-if="isAllClear" class="action-required__empty">
      <i class="pi pi-check-circle" aria-hidden="true" />
      <div>
        <strong>Alles im grünen Bereich.</strong>
        Keine kritischen Budgets, keine Buchungen ohne Zuordnung.
      </div>
    </div>

    <ul v-else class="action-required__list">
      <!-- 1. Kritische Budgets (warning/over) — hoechste Prio, roter Ampel-Indikator -->
      <li v-if="hasCritical" class="action-required__item action-required__item--danger">
        <span class="action-required__icon action-required__icon--danger" aria-hidden="true">
          <i class="pi pi-exclamation-triangle" />
        </span>
        <div class="action-required__body">
          <NuxtLink to="/budgeting/budgets" class="action-required__link">
            <strong>
              {{ criticalBudgets.length === 1
                ? `Budget „${criticalBudgets[0].name}" ist ${criticalBudgets[0].severity === 'over' ? 'überzogen' : 'knapp'}`
                : `${criticalBudgets.length} Budgets brauchen Aufmerksamkeit` }}
            </strong>
            <span v-if="criticalBudgets.length > 1" class="action-required__detail">
              <template v-for="(alert, idx) in criticalBudgets.slice(0, 3)" :key="alert.budgetId">
                <span>{{ alert.name }} ({{ alert.percentUsed.toFixed(0) }}%)</span><template v-if="idx < Math.min(criticalBudgets.length, 3) - 1">, </template>
              </template>
              <template v-if="criticalBudgets.length > 3">…</template>
            </span>
          </NuxtLink>
        </div>
        <i class="pi pi-arrow-right action-required__chevron" aria-hidden="true" />
      </li>

      <!-- 2. Buchungen ohne Budget — gelber Hinweis -->
      <li v-if="hasUnassigned" class="action-required__item action-required__item--warn">
        <span class="action-required__icon action-required__icon--warn" aria-hidden="true">
          <i class="pi pi-question-circle" />
        </span>
        <div class="action-required__body">
          <NuxtLink to="/transactions/expenses" class="action-required__link">
            <strong>{{ formatMoney(props.unassignedExpenses) }} ohne Budgetzuordnung diesen Monat</strong>
            <span class="action-required__detail">
              Ausgaben, die keinem Budget zugewiesen sind — entweder zuordnen oder als „Sonstiges" akzeptieren.
            </span>
          </NuxtLink>
        </div>
        <i class="pi pi-arrow-right action-required__chevron" aria-hidden="true" />
      </li>

      <!-- 3. Letzte Buchung — Schnellzugriff, neutraler Ton -->
      <li v-if="hasLatest && latestEntry" class="action-required__item action-required__item--neutral">
        <span class="action-required__icon action-required__icon--neutral" aria-hidden="true">
          <i :class="latestEntry.kind === 'income' ? 'pi pi-arrow-down-left' : 'pi pi-arrow-up-right'" />
        </span>
        <div class="action-required__body">
          <NuxtLink to="/transactions/expenses" class="action-required__link">
            <strong>
              Letzte Buchung: {{ latestEntry.description || (latestEntry.kind === 'income' ? 'Einnahme' : 'Ausgabe') }}
            </strong>
            <span class="action-required__detail">
              {{ formatMoney(latestEntry.amount) }} ·
              {{ new Date(latestEntry.date).toLocaleDateString('de-DE') }}
              <template v-if="latestEntry.userDisplayName"> · {{ latestEntry.userDisplayName }}</template>
            </span>
          </NuxtLink>
        </div>
        <i class="pi pi-arrow-right action-required__chevron" aria-hidden="true" />
      </li>

      <!-- 4. Freies Restbudget — informativ, gruen, am unteren Rand -->
      <li v-if="hasFreeBudget && !hasCritical" class="action-required__item action-required__item--ok">
        <span class="action-required__icon action-required__icon--ok" aria-hidden="true">
          <i class="pi pi-check" />
        </span>
        <div class="action-required__body">
          <strong>{{ formatMoney(freeBudgetTotal) }} freies Restbudget diesen Monat</strong>
          <span class="action-required__detail">
            Verteilt über alle Budgets, die aktuell im Plan liegen.
          </span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.action-required {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.66));
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 1.1rem 1.25rem;
  margin-bottom: 1.25rem;
  box-shadow: 0 12px 32px rgba(2, 6, 23, 0.22);
}

.action-required__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.85rem;
  gap: 0.75rem;
}

.action-required__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-text-primary, #f1f5f9);
  text-transform: uppercase;
}

.action-required__count {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.action-required__count--warning {
  background: rgba(251, 191, 36, 0.18);
  color: var(--color-accent-warning-text, #fbbf24);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.action-required__count--over {
  background: rgba(248, 113, 113, 0.18);
  color: var(--color-accent-danger-text, #f87171);
  border: 1px solid rgba(248, 113, 113, 0.32);
}

.action-required__empty {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem 0.5rem;
  color: var(--color-text-secondary, #cbd5e1);
  font-size: 0.92rem;
}

.action-required__empty i {
  font-size: 1.4rem;
  color: var(--color-accent-success, #10b981);
  flex-shrink: 0;
}

.action-required__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.action-required__item {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.action-required__item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.action-required__item--danger {
  background: rgba(248, 113, 113, 0.06);
  border-color: rgba(248, 113, 113, 0.18);
}

.action-required__item--danger:hover {
  background: rgba(248, 113, 113, 0.1);
}

.action-required__item--warn {
  background: rgba(251, 191, 36, 0.05);
  border-color: rgba(251, 191, 36, 0.18);
}

.action-required__item--warn:hover {
  background: rgba(251, 191, 36, 0.08);
}

.action-required__item--neutral {
  background: rgba(59, 130, 246, 0.04);
  border-color: rgba(59, 130, 246, 0.14);
}

.action-required__item--ok {
  background: rgba(16, 185, 129, 0.04);
  border-color: rgba(16, 185, 129, 0.16);
}

.action-required__icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  flex-shrink: 0;
}

.action-required__icon--danger {
  background: rgba(248, 113, 113, 0.18);
  color: var(--color-accent-danger, #f87171);
}

.action-required__icon--warn {
  background: rgba(251, 191, 36, 0.18);
  color: var(--color-accent-warning, #fbbf24);
}

.action-required__icon--neutral {
  background: rgba(59, 130, 246, 0.18);
  color: var(--color-accent-primary, #60a5fa);
}

.action-required__icon--ok {
  background: rgba(16, 185, 129, 0.18);
  color: var(--color-accent-success, #34d399);
}

.action-required__body {
  flex: 1 1 auto;
  min-width: 0;
}

.action-required__link {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-decoration: none;
  color: inherit;
}

.action-required__link strong {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary, #f1f5f9);
}

.action-required__link:hover strong {
  color: var(--color-accent-primary-text, #93c5fd);
}

.action-required__detail {
  font-size: 0.78rem;
  color: var(--color-text-muted, #94a3b8);
}

.action-required__chevron {
  font-size: 0.9rem;
  color: var(--color-text-muted, #94a3b8);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.action-required__item:hover .action-required__chevron {
  opacity: 1;
}

@media (max-width: 640px) {
  .action-required {
    padding: 0.95rem 1rem;
  }
  .action-required__item {
    padding: 0.6rem 0.7rem;
    gap: 0.65rem;
  }
}
</style>
