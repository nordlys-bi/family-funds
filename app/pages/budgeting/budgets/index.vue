<!--
  Budget-Liste (ADR-0004): kompakte Uebersicht aller Budgets als virtuelle
  Konten. Pro Budget Saldo (gross), Trend und die laufende Periode; alles
  Weitere — Verlauf, Ereignisse, Versionen, Schliessen, Loeschen — liegt auf
  der Detailseite `/budgeting/budgets/:id`, auf die jede Zeile verlinkt.

  Frueher war das hier eine Monats-Ansicht mit Monatswechsler (#34) und
  Wochen-Breakdown (#82). Seit Budgets einen fortlaufenden Saldo haben, ist
  "wie viel ist noch da?" die Hauptfrage; die Perioden-Auswertung zeigt jede
  Zeile fuer die laufende Periode, Vergangenes der Saldo-Verlauf.

  Owner-only (#128): Anlegen, Bearbeiten und Loeschen nur fuer Owner.
  Umbuchen ist eine Buchung (ADR-0004) und fuer alle Mitglieder direkt in
  der Liste erreichbar, weil es die haeufigste Aktion auf einem Budget ist:
  mobil per Swipe nach links, auf Desktop als kleiner Button in der Zeile.
  Swipe nach rechts bleibt Bearbeiten (#140, nur Owner). Loeschen ist aus
  dem Swipe raus — es scheitert bei jedem Budget mit Buchungen ohnehin und
  liegt (mit Begruendung, wenn gesperrt) im Menue der Detailseite.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Notice } from '~/types/planning'
import type { BudgetListItem } from '~/types/budget'
import { isFirstRun } from '~/utils/household-age'
import { MOBILE_LIST_QUERY } from '~/composables/useListSwipe'

definePageMeta({ layout: 'default' })

const { activeHousehold, canManageHousehold, fetchHouseholds } = useHousehold()
// Eigene Swipe-Entscheidung statt useListSwipe: Umbuchen duerfen auch
// MEMBER, deshalb ist Swipe mobil fuer alle an (Bearbeiten nur fuer Owner).
const isMobileList = useMediaQuery(MOBILE_LIST_QUERY)

const budgets = ref<BudgetListItem[]>([])
const savingsGoals = ref<Array<{ id: string; name: string }>>([])
// SSR-Initial-Render: `loading` startet auf true, damit EmptyState sofort
// den Spinner zeigt statt eines leeren Renders bis zur Hydration.
const loading = ref(true)
const notice = ref<Notice | null>(null)
const showClosed = ref(false)
const dialogs = ref<{
  openCreate: () => void
  openEdit: (budget: BudgetListItem) => void
  openTransfer: (budget: BudgetListItem) => void
} | null>(null)

const householdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')
const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)

const budgetsById = computed(() => new Map(budgets.value.map((budget) => [budget.id, budget] as const)))
const targetName = (budget: BudgetListItem) =>
  budget.carryoverToBudgetId ? budgetsById.value.get(budget.carryoverToBudgetId)?.name ?? null : null

// Geschlossen = Stichtag erreicht. Ein Budget mit Stichtag in der Zukunft
// laeuft noch und gehoert zu den offenen.
const isClosedNow = (budget: BudgetListItem) => Boolean(budget.closedAt && new Date(budget.closedAt) <= new Date())
const openBudgets = computed(() => budgets.value.filter((budget) => !isClosedNow(budget)))
// Geschlossene ans Ende und standardmaessig eingeklappt: Ihr Saldo lebt im
// Ziel-Budget weiter, sie sind nur noch Historie.
const closedBudgets = computed(() => budgets.value.filter(isClosedNow))

const totalBalance = computed(() =>
  openBudgets.value.reduce((sum, budget) => sum + (budget.balance?.balance ?? 0), 0),
)

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
const showFirstTimeEmpty = computed(() => budgets.value.length === 0 && isFirstRun(activeHousehold.value))

async function loadBudgets() {
  if (!householdId.value) {
    budgets.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    // Spartoepfe nur fuer den Umbuchen-Dialog (wie auf der Detailseite).
    const [data, householdData] = await Promise.all([
      $fetch<{ budgets: BudgetListItem[] }>(`/api/households/${householdId.value}/budgets`),
      $fetch<{ household: { savingsGoals: Array<{ id: string; name: string }> } | null }>('/api/households/current'),
    ])
    budgets.value = data.budgets
    savingsGoals.value = (householdData.household?.savingsGoals ?? []).map((goal) => ({ id: goal.id, name: goal.name }))
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Budgets konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadBudgets()
})
watch(householdId, loadBudgets)

const hasSavingsGoals = computed(() => savingsGoals.value.length > 0)
const NO_GOAL_HINT = 'Lege zuerst einen Spartopf an, um umzubuchen.'

// Ohne Spartopf kein Dialog (er haette nichts zur Auswahl), sondern ein
// Hinweis mit dem Weg dorthin — still nichts tun wuerde wie ein Fehler wirken.
function openTransfer(budget: BudgetListItem) {
  if (!hasSavingsGoals.value) {
    notice.value = { severity: 'info', text: NO_GOAL_HINT }
    return
  }
  dialogs.value?.openTransfer(budget)
}
</script>

<template>
  <ListPageShell title="Budgets">
    <template v-if="openBudgets.length > 0" #summary>
      <Tag :severity="totalBalance < 0 ? 'danger' : 'success'" :value="`Saldo gesamt ${formatMoney(totalBalance)}`" />
    </template>
    <template #toolbar>
      <!-- Issue #99: ein Anlegen-Affordance pro Seite — im First-Time-
           EmptyState hat die CTA dort Vorrang. -->
      <Button
        v-if="canManageHousehold && !showFirstTimeEmpty && !loading"
        label="Budget anlegen"
        icon="pi pi-plus"
        severity="success"
        @click="dialogs?.openCreate()"
      />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
      <NuxtLink v-if="notice.text === NO_GOAL_HINT" to="/budgeting/savings" class="notice-link">Zu den Spartöpfen</NuxtLink>
    </Message>

    <!-- OWNER-only Erklaerung (issue #128). -->
    <Message v-if="activeHousehold && !canManageHousehold" severity="warn" variant="simple">
      Nur Owner können Budgets anlegen, bearbeiten, schließen und löschen. Umbuchen zwischen Budget und Spartopf geht für alle Mitglieder – direkt in der Liste (auf dem Handy nach links wischen) oder auf der Detailseite.
    </Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Budgets werden geladen"
      loading-text="Wir holen die Budgets und ihre Salden."
    />

    <EmptyState
      v-if="!loading && activeHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-chart-line"
      icon-tone="accent"
      headline="Noch keine Budgets"
      :description="canManageHousehold
        ? 'Lege dein erstes Budget an, um Ausgaben pro Kategorie zu planen — z. B. Lebensmittel, Miete, Freizeit.'
        : 'Ein Owner des Haushalts kann Budgets anlegen, um Ausgaben pro Kategorie zu planen.'"
      :cta="canManageHousehold
        ? { label: 'Budget anlegen', onClick: () => dialogs?.openCreate(), severity: 'primary' }
        : undefined"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && budgets.length === 0"
      variant="no-data"
      icon="pi pi-chart-line"
      icon-tone="muted"
      headline="Keine Budgets"
      :description="canManageHousehold
        ? 'Lege ein Budget an, um Ausgaben pro Kategorie zu planen.'
        : 'Ein Owner des Haushalts kann ein Budget anlegen.'"
    />

    <ListPanel
      v-if="!loading && activeHousehold && openBudgets.length > 0"
      variant="primary"
      compact
      :badge="`${openBudgets.length} aktiv`"
    >
      <ul class="budget-list">
        <li v-for="budget in openBudgets" :key="budget.id">
          <SwipeableListItem
            :disabled="!isMobileList"
            swipe-right-icon="pi pi-pen-to-square"
            :swipe-right-label="canManageHousehold ? 'Bearbeiten' : undefined"
            swipe-left-icon="pi pi-arrow-right-arrow-left"
            swipe-left-label="Umbuchen"
            swipe-left-severity="warning"
            @swipe-right="dialogs?.openEdit(budget)"
            @swipe-left="openTransfer(budget)"
          >
            <BudgetListRow :budget="budget" :format-money="formatMoney" :target-name="targetName(budget)">
              <template #actions>
                <Button
                  v-if="!isMobileList"
                  icon="pi pi-arrow-right-arrow-left"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  class="row-transfer"
                  :aria-label="`${budget.name} umbuchen`"
                  :title="hasSavingsGoals ? 'Umbuchen' : NO_GOAL_HINT"
                  :disabled="!hasSavingsGoals"
                  @click.stop.prevent="openTransfer(budget)"
                />
              </template>
            </BudgetListRow>
          </SwipeableListItem>
        </li>
      </ul>
    </ListPanel>

    <section v-if="!loading && closedBudgets.length > 0" class="closed-section">
      <button
        type="button"
        class="closed-section__toggle"
        :aria-expanded="showClosed"
        @click="showClosed = !showClosed"
      >
        <i class="pi" :class="showClosed ? 'pi-chevron-down' : 'pi-chevron-right'" aria-hidden="true" />
        Geschlossene Budgets ({{ closedBudgets.length }})
      </button>
      <ul v-if="showClosed" class="budget-list">
        <li v-for="budget in closedBudgets" :key="budget.id">
          <BudgetListRow :budget="budget" :format-money="formatMoney" :target-name="targetName(budget)" />
        </li>
      </ul>
    </section>

    <BudgetActionDialogs
      v-if="householdId"
      ref="dialogs"
      :household-id="householdId"
      :budgets="budgets"
      :savings-goals="savingsGoals"
      :currency="currencyCode"
      @changed="loadBudgets"
      @notice="notice = $event"
    />
  </ListPageShell>
</template>

<style scoped>
.budget-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row-transfer {
  flex-shrink: 0;
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
}

.notice-link {
  margin-left: 0.35rem;
  color: inherit;
  font-weight: 700;
}

.closed-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.closed-section__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.35rem 0.2rem;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.closed-section__toggle .pi {
  font-size: 0.7rem;
}

.closed-section__toggle:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
</style>
