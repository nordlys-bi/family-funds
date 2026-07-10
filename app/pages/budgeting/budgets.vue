<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Frequency, Notice } from '~/types/planning'

definePageMeta({ layout: 'default' })

type BudgetVersion = {
  id: string
  amount: number
  frequency: Frequency
  validFrom: string
}

type BudgetItem = {
  id: string
  key: string
  name: string
  versions: BudgetVersion[]
}

type BudgetOverviewItem = {
  budgetId: string
  key: string
  name: string
  currentAmount: number | null
  currentFrequency: Frequency | null
  currentValidFrom: string | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  periodCount: number
  versionCount: number
}

type BudgetOverview = {
  plannedTotal: number
  spentTotal: number
  remainingTotal: number
  unassignedSpent: number
  budgets: BudgetOverviewItem[]
  unassigned: { name: string; spentAmount: number; remainingAmount: number }
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
}

import { isFirstRun } from '~/utils/household-age'
import { currentMonthYYYYMM, isValidMonthYYYYMM, formatMonthLabel } from '~/utils/month-filter'

const { activeHousehold, fetchHouseholds } = useHousehold()
const route = useRoute()
const router = useRouter()

const currentHousehold = ref<PlanningHousehold | null>(null)
const budgetOverview = ref<BudgetOverview | null>(null)
const loading = ref(false)
const notice = ref<Notice | null>(null)
const budgetLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const budgetDialogOpen = ref(false)

// === Month-Filter (issue #34) =========================================
// Initial aus URL-Query ?month=YYYY-MM, sonst aktueller Monat. Validation
// greift via isValidMonthYYYYMM — ungültige Werte fallen still auf den
// aktuellen Monat zurück (deep-linkbar ohne explizite Fehlermeldung).
//
// Pattern-Vorbild: useTransactionList für /transactions/expenses — gleiche
// URL-Sync-Strategie (router.replace statt push, Default-Monat ohne Query).
const month = ref<string>(
  typeof route.query.month === 'string' && isValidMonthYYYYMM(route.query.month)
    ? route.query.month
    : currentMonthYYYYMM(),
)
const monthLabel = computed(() => formatMonthLabel(month.value))
const isCurrentMonth = computed(() => month.value === currentMonthYYYYMM())

// Prev/Next-Monats-Berechnung. Reines Date-Arithmetic, kein useState noetig.
function shiftMonth(delta: number): string {
  const [yearStr, monthStr] = month.value.split('-')
  const shifted = new Date(Number(yearStr), Number(monthStr) - 1 + delta, 1)
  return currentMonthYYYYMM(shifted)
}
const prevMonth = computed(() => shiftMonth(-1))
const nextMonth = computed(() => shiftMonth(1))

// URL-Sync + Reload. Wie in useTransactionList: aktueller Monat -> Query
// loeschen (saubere Default-URL), andere Monate -> ?month=YYYY-MM.
async function onMonthChange(newMonth: string) {
  if (!isValidMonthYYYYMM(newMonth)) {
    month.value = currentMonthYYYYMM()
    return
  }
  month.value = newMonth
  const current = currentMonthYYYYMM()
  const query = newMonth === current ? {} : { month: newMonth }
  await router.replace({ query })
  await loadOverview()
}

const budgetForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
})
const budgetEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const showFirstTimeEmpty = computed(
  () => (currentHousehold.value?.budgets.length ?? 0) === 0 && isFirstRunHousehold.value,
)

const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)
const formatDate = formatPlanningDate

// Haushalt-Daten sind monats-unabhaengig (Budgets mit Versionen, Namen).
// Einmal geladen, nur Overview wechselt pro Monat.
async function loadHousehold() {
  loading.value = true
  try {
    const data = await $fetch<{ household: PlanningHousehold | null }>('/api/households/current')
    currentHousehold.value = data.household
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

// Monats-spezifischer Overview-Load gegen den dedizierten Endpoint.
// Endpoint akzeptiert ?month=YYYY-MM, validiert und 400'd bei Müll.
async function loadOverview() {
  if (!activeHouseholdId.value) {
    budgetOverview.value = null
    return
  }
  budgetLoading.value = true
  try {
    const data = await $fetch<{ budgetOverview: BudgetOverview | null }>(
      `/api/households/${activeHouseholdId.value}/budget-overview`,
      { params: { month: month.value } },
    )
    budgetOverview.value = data.budgetOverview ?? null
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Budgetübersicht konnte nicht geladen werden: ' + (error.statusMessage || error.message) }
    budgetOverview.value = null
  } finally {
    budgetLoading.value = false
  }
}

const loadPlanning = async () => {
  await Promise.all([loadHousehold(), loadOverview()])
}

const resetBudgetForm = () => {
  budgetForm.value = {
    name: '',
    amount: null,
    frequency: 'MONTHLY',
    validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
  }
  budgetEditId.value = null
}

const editBudget = (budget: BudgetItem) => {
  budgetEditId.value = budget.id
  const latestVersion = budget.versions[0]
  budgetForm.value = {
    name: budget.name,
    amount: latestVersion ? latestVersion.amount / 100 : null,
    frequency: latestVersion?.frequency ?? 'MONTHLY',
    validFrom: latestVersion ? new Date(latestVersion.validFrom) : new Date(),
  }
  budgetDialogOpen.value = true
}

const openBudgetDialog = () => { resetBudgetForm(); budgetDialogOpen.value = true }
const closeBudgetDialog = () => { budgetDialogOpen.value = false; resetBudgetForm() }

watch(
  () => budgetForm.value.frequency,
  (frequency) => {
    if (!budgetEditId.value) {
      budgetForm.value.validFrom = getPeriodStartDate(new Date(), frequency)
    }
  },
)

const saveBudget = async () => {
  if (!activeHouseholdId.value) return
  budgetLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(budgetEditId.value)
    const payload = {
      kind: 'budget',
      ...(budgetEditId.value ? { id: budgetEditId.value } : {}),
      name: budgetForm.value.name,
      amount: budgetForm.value.amount,
      frequency: budgetForm.value.frequency,
      validFrom: formatDateToInputString(budgetForm.value.validFrom),
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: budgetEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadPlanning()
    closeBudgetDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Budget wurde aktualisiert.' : 'Budget wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Budget konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    budgetLoading.value = false
  }
}

const deletePlanningItem = async (id: string) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `budget:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/budgets/${id}`, {
      method: 'DELETE',
    })
    await loadPlanning()
    notice.value = { severity: 'success', text: 'Eintrag wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Eintrag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

const budgetOverviewMap = computed(
  () => new Map(budgetOverview.value?.budgets.map((item) => [item.budgetId, item] as const) ?? []),
)
const getBudgetOverviewItem = (budgetId: string) => budgetOverviewMap.value.get(budgetId) ?? null

onMounted(async () => {
  await fetchHouseholds()
  await loadPlanning()
})
watch(activeHouseholdId, async () => { await loadPlanning() })
</script>

<template>
  <ListPageShell
    title="Budget pro Zeitraum"
    description="Plane, wie viel du pro Periode für einzelne Kategorien ausgeben willst. Die Progress-Bar zeigt, wie viel vom monatlichen Budget bereits verbraucht ist."
  >
    <template #summary>
      <Tag severity="info" :value="`Geplant ${formatMoney(budgetOverview?.plannedTotal ?? 0)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(budgetOverview?.spentTotal ?? 0)}`" />
      <Tag severity="success" :value="`Rest ${formatMoney(budgetOverview?.remainingTotal ?? 0)}`" />
    </template>

    <template #toolbar>
      <!-- Monatswechsler (issue #34): Prev / Label / Next, deep-linkbar
           via ?month=YYYY-MM, aktueller Monat mit grünem 'Jetzt'-Badge. -->
      <div class="month-switcher" role="group" aria-label="Monatsauswahl">
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          text
          rounded
          :aria-label="`Vorheriger Monat (${formatMonthLabel(prevMonth)})`"
          :title="formatMonthLabel(prevMonth)"
          @click="onMonthChange(prevMonth)"
        />
        <div class="month-switcher__center">
          <span class="month-switcher__label">{{ monthLabel }}</span>
          <Tag v-if="isCurrentMonth" severity="success" value="Jetzt" class="month-switcher__badge" />
        </div>
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          text
          rounded
          :aria-label="`Nächster Monat (${formatMonthLabel(nextMonth)})`"
          :title="formatMonthLabel(nextMonth)"
          @click="onMonthChange(nextMonth)"
        />
      </div>
      <Button label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Budgetdaten werden geladen"
      loading-text="Wir holen den aktuellen Haushalt und die vorhandenen Budgets."
    />

    <EmptyState
      v-if="!loading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-chart-line"
      icon-tone="accent"
      headline="Noch keine Budgets"
      description="Lege dein erstes Budget an, um Ausgaben pro Kategorie zu planen — z. B. Lebensmittel, Miete, Freizeit."
      :cta="{ label: 'Budget anlegen', onClick: openBudgetDialog, severity: 'primary' }"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && currentHousehold.budgets.length === 0"
      variant="no-data"
      icon="pi pi-chart-line"
      icon-tone="muted"
      headline="Keine Budgets"
      description="Lege ein Budget an, um Auswertungen pro Kategorie zu sehen."
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold && currentHousehold.budgets.length > 0"
      variant="primary"
      compact
      :badge="`${currentHousehold.budgets.length} Einträge`"
    >
      <ItemCard
        v-for="budget in currentHousehold.budgets"
        :key="budget.id"
        variant="primary"
      >
        <template #main>
          <span class="row-title">{{ budget.name }}</span>
          <span class="row-sub">
            <span v-if="getBudgetOverviewItem(budget.id)?.currentFrequency" class="row-tag">
              {{ frequencyLabel(getBudgetOverviewItem(budget.id)!.currentFrequency!) }}
            </span>
            <span>gültig ab {{ formatDate(getBudgetOverviewItem(budget.id)?.currentValidFrom ?? null) }}</span>
            <span>·</span>
            <span>{{ getBudgetOverviewItem(budget.id)?.periodCount ?? 0 }} Perioden</span>
          </span>
        </template>
        <template #progress>
          <ListProgressBar
            :percent="getBudgetOverviewItem(budget.id)?.plannedAmount
              ? (getBudgetOverviewItem(budget.id)!.spentAmount / getBudgetOverviewItem(budget.id)!.plannedAmount) * 100
              : 0"
            tone="auto"
            :label="`${formatMoney(getBudgetOverviewItem(budget.id)?.spentAmount ?? 0)} / ${formatMoney(getBudgetOverviewItem(budget.id)?.plannedAmount ?? 0)}`"
          />
        </template>
        <template #actions>
          <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Budget bearbeiten" @click="editBudget(budget)" />
          <Button
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            text
            aria-label="Budget löschen"
            :loading="actionLoadingKey === `budget:${budget.id}`"
            @click="deletePlanningItem(budget.id)"
          />
        </template>
      </ItemCard>

      <ItemCard v-if="budgetOverview" variant="muted">
        <template #main>
          <span class="row-title">Sonstiges <span class="row-tag-muted">Auto-Bucket</span></span>
          <span class="row-sub">Virtuelle Kategorie für Ausgaben ohne Budgetzuordnung</span>
        </template>
        <template #aside>
          <div>
            {{ formatMoney(budgetOverview.unassigned.spentAmount) }}
            <span class="amount-secondary">verbraucht</span>
          </div>
        </template>
      </ItemCard>

      <div v-if="currentHousehold.budgets.length === 0" class="empty-list">
        Noch keine Budgets angelegt.
      </div>
    </ListPanel>

    <FormDialog
      v-model:visible="budgetDialogOpen"
      :header="budgetEditId ? 'Budget bearbeiten' : 'Budget anlegen'"
      :submit-label="budgetEditId ? 'Budget aktualisieren' : 'Budget anlegen'"
      :saving="budgetLoading"
      @save="saveBudget"
      @cancel="closeBudgetDialog"
    >
      <BudgetForm v-model="budgetForm" :currency="currencyCode" />
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.row-title {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.row-sub {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.row-tag {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(59, 130, 246, 0.16);
  color: #93c5fd;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.row-tag-muted {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  margin-left: 6px;
}

.amount-secondary {
  display: block;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-weight: 500;
  margin-top: 2px;
}

.empty-list {
  padding: 16px;
  border-radius: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  color: var(--color-text-muted);
  text-align: center;
  font-size: 0.85rem;
}

/* === Monatswechsler (issue #34) === */
.month-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.month-switcher__center {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 8rem;
  padding: 0 8px;
}

.month-switcher__label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary, #f1f5f9);
  white-space: nowrap;
}

.month-switcher__badge {
  font-size: 0.65rem !important;
  padding: 1px 6px !important;
}
</style>
