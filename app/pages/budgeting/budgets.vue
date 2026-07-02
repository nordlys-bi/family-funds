<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

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
  currentValidTo: string | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  periodCount: number
  versionCount: number
}

type BudgetOverview = {
  monthStart: string
  monthEnd: string
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

type Notice = { severity: 'success' | 'warn' | 'error'; text: string }
type DateFormValue = Date | null

const { activeHousehold, fetchHouseholds } = useHousehold()

const currentHousehold = ref<PlanningHousehold | null>(null)
const budgetOverview = ref<BudgetOverview | null>(null)
const loading = ref(false)
const notice = ref<Notice | null>(null)
const budgetLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const budgetDialogOpen = ref(false)

const budgetForm = ref({
  name: '',
  amount: '',
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY') as DateFormValue,
})
const budgetEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const frequencyLabel = (frequency: Frequency) => {
  switch (frequency) {
    case 'WEEKLY': return 'Wöchentlich'
    case 'MONTHLY': return 'Monatlich'
    case 'QUARTERLY': return 'Quartalsweise'
    case 'YEARLY': return 'Jährlich'
    case 'ONCE': return 'Einmalig'
  }
}

const frequencyOptions = [
  { label: 'Wöchentlich', value: 'WEEKLY' as Frequency },
  { label: 'Monatlich', value: 'MONTHLY' as Frequency },
  { label: 'Quartalsweise', value: 'QUARTERLY' as Frequency },
  { label: 'Jährlich', value: 'YEARLY' as Frequency },
  { label: 'Einmalig', value: 'ONCE' as Frequency },
]

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)

const formatDate = (value: string | null) => {
  if (!value) return 'Offen'
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPeriodStartDate(value: Date, frequency: Frequency) {
  const date = new Date(value)
  date.setHours(12, 0, 0, 0)

  switch (frequency) {
    case 'WEEKLY': {
      const day = date.getDay()
      const offset = day === 0 ? -6 : 1 - day
      date.setDate(date.getDate() + offset)
      break
    }
    case 'MONTHLY':
      date.setDate(1)
      break
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3
      date.setMonth(quarterStartMonth, 1)
      break
    }
    case 'YEARLY':
      date.setMonth(0, 1)
      break
    case 'ONCE':
      break
  }

  return date
}

const loadPlanning = async () => {
  loading.value = true
  try {
    const data = await $fetch<{ household: PlanningHousehold | null; budgetOverview: BudgetOverview | null }>(
      '/api/households/current',
    )
    currentHousehold.value = data.household
    budgetOverview.value = data.budgetOverview ?? null
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    loading.value = false
  }
}

const resetBudgetForm = () => {
  budgetForm.value = {
    name: '',
    amount: '',
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
    amount: latestVersion ? (latestVersion.amount / 100).toFixed(2).replace('.', ',') : '',
    frequency: latestVersion?.frequency ?? 'MONTHLY',
    validFrom: latestVersion ? new Date(latestVersion.validFrom) : new Date(),
  }
  budgetDialogOpen.value = true
}

const openBudgetDialog = () => {
  resetBudgetForm()
  budgetDialogOpen.value = true
}

const closeBudgetDialog = () => {
  budgetDialogOpen.value = false
  resetBudgetForm()
}

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
      validFrom: budgetForm.value.validFrom ? formatDateInput(budgetForm.value.validFrom) : undefined,
    }

    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: budgetEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })

    await loadPlanning()
    closeBudgetDialog()
    notice.value = {
      severity: 'success',
      text: isEdit ? 'Budget wurde aktualisiert.' : 'Budget wurde angelegt.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Budget konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    budgetLoading.value = false
  }
}

const deletePlanningItem = async (id: string) => {
  if (!activeHouseholdId.value) return

  actionLoadingKey.value = `budget:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: 'DELETE',
      body: { kind: 'budget', id },
    })

    await loadPlanning()
    notice.value = {
      severity: 'success',
      text: 'Eintrag wurde gelöscht.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Eintrag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    actionLoadingKey.value = null
  }
}

const monthBudgetBalance = computed(() => budgetOverview.value?.remainingTotal ?? 0)
const monthBudgetSpent = computed(() => budgetOverview.value?.spentTotal ?? 0)
const monthBudgetPlanned = computed(() => budgetOverview.value?.plannedTotal ?? 0)

const budgetOverviewMap = computed(
  () => new Map(budgetOverview.value?.budgets.map((item) => [item.budgetId, item] as const) ?? []),
)
const getBudgetOverviewItem = (budgetId: string) => budgetOverviewMap.value.get(budgetId) ?? null

onMounted(async () => {
  await fetchHouseholds()
  await loadPlanning()
})

watch(activeHouseholdId, async () => {
  await loadPlanning()
})
</script>

<template>
  <ListPageShell
    eyebrow="Meilenstein 4 / Budgets"
    title="Budget pro Zeitraum"
    description="Plane, wie viel du pro Periode fuer einzelne Kategorien ausgeben willst. Versionen werden automatisch anhand des Gueltig-ab-Datums aktiv."
  >
    <template #summary>
      <Tag severity="info" :value="`Geplant ${formatMoney(monthBudgetPlanned)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(monthBudgetSpent)}`" />
      <Tag severity="success" :value="`Restbudget ${formatMoney(monthBudgetBalance)}`" />
    </template>

    <template #toolbar>
      <Button label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Budgetdaten werden geladen"
      loading-text="Wir holen den aktuellen Haushalt und die vorhandenen Budgets."
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold"
      kicker="Budget"
      title="Budget pro Zeitraum"
      variant="primary"
      :badge="`${currentHousehold.budgets.length} Einträge`"
    >
      <template #actions>
        <Button label="Neu" icon="pi pi-plus" severity="success" size="small" @click="openBudgetDialog" />
      </template>

      <ItemCard v-for="budget in currentHousehold.budgets" :key="budget.id">
        <template #main>
          <div class="budget-row">
            <h3>{{ budget.name }}</h3>
            <span class="budget-pill">{{ formatMoney(getBudgetOverviewItem(budget.id)?.plannedAmount ?? 0) }}</span>
          </div>
          <p>
            {{
              getBudgetOverviewItem(budget.id)?.currentFrequency
                ? frequencyLabel(getBudgetOverviewItem(budget.id)!.currentFrequency!)
                : 'Keine aktive Version'
            }}
            · gültig ab {{ formatDate(getBudgetOverviewItem(budget.id)?.currentValidFrom ?? null) }}
            · {{ getBudgetOverviewItem(budget.id)?.versionCount ?? 0 }} Versionen
          </p>
          <p class="budget-metrics">
            Verbraucht {{ formatMoney(getBudgetOverviewItem(budget.id)?.spentAmount ?? 0) }}
            · Rest {{ formatMoney(getBudgetOverviewItem(budget.id)?.remainingAmount ?? 0) }}
            · {{ getBudgetOverviewItem(budget.id)?.periodCount ?? 0 }} Perioden im Monat
          </p>
        </template>
        <template #actions>
          <Button label="Bearbeiten" icon="pi pi-pen-to-square" severity="secondary" outlined size="small" @click="editBudget(budget)" />
          <Button
            label="Löschen"
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            :loading="actionLoadingKey === `budget:${budget.id}`"
            @click="deletePlanningItem(budget.id)"
          />
        </template>
      </ItemCard>

      <div v-if="currentHousehold.budgets.length === 0" class="empty-list">
        Noch keine Budgets angelegt.
      </div>

      <ItemCard v-if="budgetOverview">
        <template #main>
          <div class="budget-row">
            <h3>{{ budgetOverview.unassigned.name }}</h3>
            <span class="budget-pill">{{ formatMoney(budgetOverview.unassigned.spentAmount) }}</span>
          </div>
          <p>Virtuelle Kategorie für Ausgaben ohne Budgetzuordnung.</p>
          <p class="budget-metrics">
            Verbraucht {{ formatMoney(budgetOverview.unassigned.spentAmount) }}
            · Rest {{ formatMoney(budgetOverview.unassigned.remainingAmount) }}
          </p>
        </template>
      </ItemCard>
    </ListPanel>

    <FormDialog
      v-model:visible="budgetDialogOpen"
      :header="budgetEditId ? 'Budget bearbeiten' : 'Budget anlegen'"
      :submit-label="budgetEditId ? 'Budget aktualisieren' : 'Budget anlegen'"
      :saving="budgetLoading"
      @save="saveBudget"
      @cancel="closeBudgetDialog"
    >
      <FormField label="Name" html-for="budget-name" wide>
        <InputText id="budget-name" v-model="budgetForm.name" placeholder="z. B. Lebensmittel" />
      </FormField>
      <FormField label="Betrag" html-for="budget-amount">
        <InputText id="budget-amount" v-model="budgetForm.amount" placeholder="0,00" inputmode="decimal" />
      </FormField>
      <FormField label="Frequenz" html-for="budget-frequency">
        <Select
          id="budget-frequency"
          v-model="budgetForm.frequency"
          :options="frequencyOptions"
          optionLabel="label"
          optionValue="value"
        />
      </FormField>
      <FormField label="Gültig ab" html-for="budget-valid-from">
        <DatePicker
          id="budget-valid-from"
          v-model="budgetForm.validFrom"
          showIcon
          dateFormat="dd.mm.yy"
        />
      </FormField>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.budget-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.budget-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}

.budget-metrics {
  color: #cbd5e1;
}

.empty-list {
  padding: 1.1rem 1rem;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.16);
  color: #94a3b8;
  text-align: center;
  background: rgba(15, 23, 42, 0.36);
}
</style>