<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type DashboardData = {
  householdId: string
  monthSummary: {
    income: number
    expenses: number
    balance: number
    unassignedExpenses: number
  }
  budgetAlerts: Array<{
    budgetId: string
    name: string
    plannedAmount: number
    spentAmount: number
    remainingAmount: number
    percentUsed: number
    severity: 'ok' | 'warning' | 'over'
    // Issue #82: Wochen-Detail ist im Frontend optional, daher hier
    // ebenfalls optional. Frontend prueft `currentFrequency === 'WEEKLY'`,
    // bevor es `periods` rendert.
    currentFrequency?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE' | null
    periods?: Array<{
      start: string
      end: string
      plannedAmount: number
      spentAmount: number
      remainingAmount: number
      percentUsed: number
      severity: 'ok' | 'warning' | 'over'
    }>
    // Issue #60 / ADR 0003: Forecast auf Monatsende. Linear extrapoliert,
    // serverseitig berechnet. Frontend rendert es zwischen Ist-Row und
    // Wochen-Toggle.
    forecast?: {
      forecastTotal: number
      forecastRemaining: number
      severity: 'on-track' | 'warning' | 'over'
      basisDays: number
      basisAmount: number
      computedAt: string
    }
  }>
  recentActivity: Array<{
    id: string
    kind: 'expense' | 'income'
    amount: number
    description: string | null
    date: string
    budgetName: string | null
    userDisplayName: string | null
  }>
  savingsGoals: Array<{
    id: string
    name: string
    targetAmount: number
    currentAmount: number
    monthlyRate: number
    percentToTarget: number
  }>
  // Issue #60 / ADR 0003: Aggregierter Forecast für den month-strip.
  // 4. Zelle „Voraussicht" (Variante 1, entschieden 2026-08-27).
  monthForecast?: {
    forecastTotal: number
    plannedTotal: number
    delta: number
    severity: 'on-track' | 'warning' | 'over'
    computedAt: string
  }
  // Issue #98: fällige, noch nicht (voll) gedeckte Recurring-Pläne
  // diesen Monat — Zähler für den „Handlungsbedarf"-Block.
  recurringDue?: {
    fixedCostsOpen: number
    fixedCostsDue: number
    incomeOpen: number
    incomeDue: number
  }
}

const { activeHousehold } = useHousehold()
const snapshot = ref<DashboardData | null>(null)
// SSR-Initial-Render-Fix: `loading` startet auf `true`, damit EmptyState
// beim ersten Render den Spinner zeigt, BEVOR `loadDashboard` in onMounted
// die Daten geladen hat. Vorher startete `loading` auf `false`, was im
// SSR zu einem leeren EmptyState-Render fuehrte (keine loading/noHousehold/
// variant/slot-Bedingung griff → leere Kommentare), und der User sah
// eine leere Page bis zur Client-Hydration.
const loading = ref(true)
const errorMessage = ref<string | null>(null)

const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)
const formatMoney = (cents: number | null | undefined) =>
  moneyFormatter.value.format((cents ?? 0) / 100)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()),
)

const summary = computed(() => snapshot.value?.monthSummary ?? null)
// Issue #60 / ADR 0003: aggregierter Forecast für die 4. Zelle.
const monthForecast = computed(() => snapshot.value?.monthForecast ?? null)

function forecastSeverityLabel(severity: 'on-track' | 'warning' | 'over'): string {
  switch (severity) {
    case 'on-track': return 'im Plan'
    case 'warning': return 'knapp über Plan'
    case 'over': return 'über Plan'
  }
}
const savingsGoals = computed(() => snapshot.value?.savingsGoals ?? [])
const budgetAlerts = computed(() => snapshot.value?.budgetAlerts ?? [])
const recentActivity = computed(() => snapshot.value?.recentActivity ?? [])
// Issue #97: der Schnellzugriff auf die letzte Buchung ist aus dem
// "Handlungsbedarf"-Block in den "Letzte Buchungen"-Panel-Header gewandert.
const latestEntry = computed(() => recentActivity.value[0] ?? null)

// Issue #97: Dashboard-Listen zeigen nur die Spitze — die volle Liste
// liegt je eine Seite tiefer, verlinkt ueber "Alle anzeigen".
const DASHBOARD_LIST_LIMIT = 3

const balanceTone = computed(() => ((summary.value?.balance ?? 0) >= 0 ? 'primary' : 'danger'))

async function loadDashboard() {
  if (!activeHousehold.value) {
    snapshot.value = null
    errorMessage.value = null
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    const data = await $fetch<DashboardData>(
      `/api/households/${activeHousehold.value.id}/dashboard`,
      { headers },
    )
    snapshot.value = data
  } catch (err: any) {
    errorMessage.value =
      err.statusMessage || err.message || 'Dashboard konnte nicht geladen werden.'
    snapshot.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDashboard)
watch(() => activeHousehold.value?.id, loadDashboard)

// Issue #91: der globale Erfassen-Dialog kann von hier aus eine Buchung
// anlegen — dann die Dashboard-Kennzahlen neu holen.
const { savedTick: quickCaptureSavedTick } = useQuickCapture()
watch(quickCaptureSavedTick, loadDashboard)
</script>

<template>
  <section class="dashboard-page">
    <!-- Kein sichtbarer Seitentitel mehr: die Navigation benennt die Seite,
         und die Begrueßung ("Hallo, Jan") plus der Erklaersatz kosteten ~300px
         toten Raum ueber dem ersten handlungsrelevanten Element. Die <h1>
         bleibt fuer Screenreader / Dokumentstruktur erhalten. -->
    <h1 class="sr-only">Dashboard — finanzieller Überblick für {{ monthLabel }}</h1>

    <EmptyState
      v-if="!activeHousehold"
      :no-household="true"
      no-household-title="Wähle einen Haushalt aus dem Menü"
      no-household-text="Damit wir dein Dashboard mit echten Daten füllen können."
    />

    <EmptyState
      v-else-if="loading && !snapshot"
      :loading="true"
      loading-title="Dashboard wird geladen"
      loading-text="Wir holen die aktuellen Zahlen aus der Datenbank."
    />

    <Message v-else-if="errorMessage" severity="error" :closable="false" class="mb-6">
      Dashboard konnte nicht geladen werden: {{ errorMessage }}
    </Message>

    <template v-else-if="snapshot">
      <!-- Handlungsbedarf (issue #37): steht jetzt ganz oben, weil die
           Alltagsfrage "Was muss ich mir ansehen?" wichtiger ist als
           "Wie hoch waren meine Einnahmen?". Issue #97: zeigt nur echten
           Handlungsbedarf (kritische Budgets, unzugeordnete Buchungen,
           fällige wiederkehrende Posten) + das freie Restbudget — sonst
           einen ruhigen Einzeiler. -->
      <DashboardActionRequired
        :budget-alerts="budgetAlerts"
        :unassigned-expenses="summary?.unassignedExpenses ?? 0"
        :recurring-due="snapshot.recurringDue ?? null"
        :format-money="formatMoney"
      />

      <!-- Issue #57: Konsolidierte Liquiditaets-Zahl (Spartoepfe +
           freies Restbudget) als eigene Karte zwischen Action-Required
           und der Monatszeile. Beantwortet die Alltagsfrage "Wieviel
           Geld liegt gerade da?" mit einem Blick, ohne dass der User
           die Summe aus zwei Panels zusammensetzen muss. Wird
           automatisch ausgeblendet, wenn weder Toepfe noch freies
           Restbudget vorhanden sind. -->
      <DashboardLiquidityCard
        :savings-goals="savingsGoals"
        :budget-alerts="budgetAlerts"
        :format-money="formatMoney"
      />

      <!-- Kompakte Monatszeile (issue #37): Der Saldo ist die Leitzahl,
           Einnahmen/Ausgaben stehen sekundaer daneben. Die "Voraussicht"
           erscheint nur, wenn sie vom Plan abweicht — "im Plan" ist keine
           Information, die eine eigene Zelle verdient. -->
      <div class="month-strip" :class="`month-strip--${balanceTone}`" role="group" aria-label="Monatsübersicht">
        <div class="month-strip__primary">
          <span class="month-strip__label">Saldo · {{ monthLabel }}</span>
          <span class="month-strip__balance">{{ formatMoney(summary?.balance) }}</span>
        </div>
        <dl class="month-strip__aside">
          <div class="month-strip__pair">
            <dt>Einnahmen</dt>
            <dd class="month-strip__pos">{{ formatMoney(summary?.income) }}</dd>
          </div>
          <div class="month-strip__pair">
            <dt>Ausgaben</dt>
            <dd class="month-strip__neg">{{ formatMoney(summary?.expenses) }}</dd>
          </div>
          <!-- Issue #60 / ADR 0003: Voraussicht auf Monatsende — nur bei
               Abweichung vom Plan (warning/over), nicht im Normalfall. -->
          <div
            v-if="monthForecast && monthForecast.severity !== 'on-track'"
            class="month-strip__pair"
            :class="`month-strip__pair--forecast--${monthForecast.severity}`"
          >
            <dt>Voraussicht</dt>
            <dd>
              {{ formatMoney(monthForecast.forecastTotal) }}
              <span class="month-strip__tag">{{ forecastSeverityLabel(monthForecast.severity) }}</span>
            </dd>
          </div>
        </dl>
      </div>

      <ListPanel title="Budget-Auslastung" :compact="true">
        <template #actions>
          <NuxtLink to="/budgeting/budgets">
            <Button label="Budget anlegen" icon="pi pi-plus" size="small" severity="secondary" outlined />
          </NuxtLink>
          <NuxtLink to="/budgeting/budgets">
            <Button
              label="Alle anzeigen"
              icon="pi pi-list"
              size="small"
              severity="secondary"
              outlined
              aria-label="Alle Budgets anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardBudgetList :alerts="budgetAlerts" :limit="DASHBOARD_LIST_LIMIT" :format-money="formatMoney" />
      </ListPanel>

      <ListPanel title="Letzte Buchungen" :compact="true">
        <template v-if="latestEntry" #subtitle>
          <NuxtLink to="/transactions/expenses" class="panel-quicklink">
            Zuletzt: {{ latestEntry.description || (latestEntry.kind === 'income' ? 'Einnahme' : 'Ausgabe') }}
            · {{ latestEntry.kind === 'income' ? '+' : '−' }}{{ formatMoney(latestEntry.amount) }}
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </NuxtLink>
        </template>
        <template #actions>
          <NuxtLink to="/transactions/expenses">
            <Button label="Ausgabe erfassen" icon="pi pi-plus" size="small" severity="primary" />
          </NuxtLink>
          <!-- Issue #53: Sekundaere "Alle anzeigen"-Action, die auf die
               volle Monatsliste der Ausgaben springt. Pattern-konsistent
               mit dem Budget- und Sparziele-Panel, deren sekundaere
               Action-Buttons ebenfalls `outlined` sind. Visuelle Hierarchie:
               der primaere "Ausgabe erfassen" (filled, primary) bleibt
               dominanter; "Alle anzeigen" daneben als Outline. -->
          <NuxtLink to="/transactions/expenses">
            <Button
              label="Alle anzeigen"
              icon="pi pi-list"
              size="small"
              severity="secondary"
              outlined
              aria-label="Alle Ausgaben anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardActivityList :activity="recentActivity" :limit="DASHBOARD_LIST_LIMIT" :format-money="formatMoney" />
      </ListPanel>

      <!-- Sparziele mit Fortschrittsbalken (issue #6 AC):
           pro Sparziel eigene Zeile mit Progressbar und
           currentAmount / targetAmount + monthlyRate. -->
      <ListPanel title="Sparziele" :compact="true">
        <template #actions>
          <NuxtLink to="/budgeting/savings">
            <Button label="Sparziel anlegen" icon="pi pi-plus" size="small" severity="secondary" outlined />
          </NuxtLink>
          <NuxtLink to="/budgeting/savings">
            <Button
              label="Alle anzeigen"
              icon="pi pi-list"
              size="small"
              severity="secondary"
              outlined
              aria-label="Alle Sparziele anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardSavingsList :goals="savingsGoals" :limit="DASHBOARD_LIST_LIMIT" :format-money="formatMoney" />
      </ListPanel>
    </template>
  </section>
</template>

<style scoped>
/* Vertikaler Rhythmus der Dashboard-Sektionen — ersetzt das
   list-page-shell__content-Layout, das der Dashboard-Wrapper vorher lieferte. */
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Issue #97: Schnellzugriff auf die letzte Buchung im Panel-Header. */
.panel-quicklink {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted, #94a3b8);
  text-decoration: none;
}

.panel-quicklink:hover {
  color: var(--color-accent-primary-text, #93c5fd);
}

.panel-quicklink .pi {
  font-size: 0.7rem;
}

/* === Kompakte Monatszeile (issue #37) === */
.month-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  flex-wrap: wrap;
  padding: 0.8rem 1.1rem;
  margin-bottom: 1.25rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 14px;
  font-variant-numeric: tabular-nums;
}

.month-strip__label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
  white-space: nowrap;
}

.month-strip__primary {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.month-strip__balance {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--color-text-primary, #f1f5f9);
}

.month-strip--primary .month-strip__balance {
  color: var(--color-accent-primary-text, #60a5fa);
}

.month-strip--danger .month-strip__balance {
  color: var(--color-accent-danger-text, #f87171);
}

.month-strip__aside {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  margin: 0;
  flex-wrap: wrap;
}

.month-strip__pair {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.month-strip__pair dt {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
}

.month-strip__pair dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-secondary, #cbd5e1);
  white-space: nowrap;
}

.month-strip__aside dd.month-strip__pos {
  color: var(--color-accent-success-text, #34d399);
}

.month-strip__aside dd.month-strip__neg {
  color: var(--color-accent-danger-text, #f87171);
}

/* Issue #60 / ADR 0003: Voraussicht nur bei Abweichung vom Plan. */
.month-strip__aside .month-strip__pair--forecast--warning dd {
  color: #fbbf24;
}

.month-strip__aside .month-strip__pair--forecast--over dd {
  color: #f87171;
}

.month-strip__tag {
  display: inline-block;
  margin-left: 0.3rem;
  font-size: 0.6rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  letter-spacing: 0.02em;
  vertical-align: middle;
  background: rgba(251, 191, 36, 0.14);
  color: #fbbf24;
}

.month-strip__pair--forecast--over .month-strip__tag {
  background: rgba(248, 113, 113, 0.14);
  color: #f87171;
}

@media (max-width: 640px) {
  .month-strip {
    gap: 0.75rem 1.25rem;
    padding: 0.8rem 0.95rem;
  }
  .month-strip__aside {
    width: 100%;
    gap: 1rem 1.75rem;
  }
}
</style>
