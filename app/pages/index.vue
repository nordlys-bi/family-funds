<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

const { user } = useAppAuth()

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
}

const { activeHousehold } = useHousehold()
const snapshot = ref<DashboardData | null>(null)
const loading = ref(false)
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
const savingsGoals = computed(() => snapshot.value?.savingsGoals ?? [])
const budgetAlerts = computed(() => snapshot.value?.budgetAlerts ?? [])
const recentActivity = computed(() => snapshot.value?.recentActivity ?? [])

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
</script>

<template>
  <ListPageShell
    eyebrow="Dashboard"
    :title="`Hallo, ${user?.displayName || 'Gast'} \u{1F44B}`"
    :description="`Dein finanzieller Überblick für ${monthLabel}.`"
  >
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
      <!-- Aktiver-Haushalt-Banner (issue #6 AC):
           Name, Waehrung, Rolle sind hier prominent sichtbar —
           nicht nur ueber den Header-Switcher. -->
      <DashboardHouseholdBanner :household="activeHousehold" />

      <!-- Handlungsbedarf (issue #37): steht jetzt ganz oben, weil die
           Alltagsfrage "Was muss ich mir ansehen?" wichtiger ist als
           "Wie hoch waren meine Einnahmen?". Zeigt kritische Budgets,
           unzugeordnete Buchungen, die letzte Buchung als Schnellzugriff
           und das freie Restbudget. -->
      <DashboardActionRequired
        :budget-alerts="budgetAlerts"
        :unassigned-expenses="summary?.unassignedExpenses ?? 0"
        :recent-activity="recentActivity"
        :format-money="formatMoney"
      />

      <!-- Kompakte Monatszeile (issue #37): Einnahmen/Ausgaben/Saldo
           als eine Zeile statt 3 dominanter Cards. Bleibt sichtbar,
           aber in sekundaerer Gewichtung. Wraps auf Mobile. -->
      <div class="month-strip" :class="`month-strip--${balanceTone}`" role="group" aria-label="Monatsuebersicht">
        <div class="month-strip__cell month-strip__cell--income">
          <span class="month-strip__label">Einnahmen</span>
          <span class="month-strip__value">{{ formatMoney(summary?.income) }}</span>
        </div>
        <div class="month-strip__divider" aria-hidden="true" />
        <div class="month-strip__cell month-strip__cell--expense">
          <span class="month-strip__label">Ausgaben</span>
          <span class="month-strip__value">{{ formatMoney(summary?.expenses) }}</span>
        </div>
        <div class="month-strip__divider" aria-hidden="true" />
        <div class="month-strip__cell month-strip__cell--balance">
          <span class="month-strip__label">Saldo</span>
          <span class="month-strip__value">{{ formatMoney(summary?.balance) }}</span>
        </div>
        <span class="month-strip__month">{{ monthLabel }}</span>
      </div>

      <ListPanel kicker="Budget" title="Budget-Auslastung" :compact="true">
        <template #actions>
          <NuxtLink to="/budgeting/budgets">
            <Button label="Budget anlegen" icon="pi pi-plus" size="small" severity="secondary" outlined />
          </NuxtLink>
        </template>
        <DashboardBudgetList :alerts="budgetAlerts" :format-money="formatMoney" />
      </ListPanel>

      <ListPanel kicker="Aktivität" title="Letzte Buchungen" :compact="true">
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
        <DashboardActivityList :activity="recentActivity" :format-money="formatMoney" />
      </ListPanel>

      <!-- Sparziele mit Fortschrittsbalken (issue #6 AC):
           pro Sparziel eigene Zeile mit Progressbar und
           currentAmount / targetAmount + monthlyRate. -->
      <ListPanel kicker="Sparen" title="Sparziele" :compact="true">
        <template #actions>
          <NuxtLink to="/budgeting/savings">
            <Button label="Sparziel anlegen" icon="pi pi-plus" size="small" severity="secondary" outlined />
          </NuxtLink>
        </template>
        <DashboardSavingsList :goals="savingsGoals" :format-money="formatMoney" />
      </ListPanel>
    </template>
  </ListPageShell>
</template>

<style scoped>
/* === Kompakte Monatszeile (issue #37) === */
.month-strip {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.1rem;
  margin-bottom: 1.25rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 14px;
  font-variant-numeric: tabular-nums;
}

.month-strip__cell {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}

.month-strip__label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
  white-space: nowrap;
}

.month-strip__value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary, #f1f5f9);
  white-space: nowrap;
}

.month-strip__cell--income .month-strip__value {
  color: var(--color-accent-success-text, #34d399);
}

.month-strip__cell--expense .month-strip__value {
  color: var(--color-accent-danger-text, #f87171);
}

.month-strip--primary .month-strip__cell--balance .month-strip__value {
  color: var(--color-accent-primary-text, #60a5fa);
}

.month-strip--danger .month-strip__cell--balance .month-strip__value {
  color: var(--color-accent-danger-text, #f87171);
}

.month-strip__divider {
  width: 1px;
  align-self: stretch;
  background: rgba(148, 163, 184, 0.18);
}

.month-strip__month {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--color-text-muted, #94a3b8);
  font-weight: 500;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .month-strip {
    flex-wrap: wrap;
    gap: 0.65rem 1rem;
    padding: 0.85rem 0.95rem;
  }
  .month-strip__divider {
    display: none;
  }
  .month-strip__month {
    margin-left: 0;
    width: 100%;
    text-align: right;
  }
}
</style>
