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
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY') as DateFormValue,
})
const budgetEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)

const formatDate = (value: string | null) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
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

const loadPlanning = async () => {
  loading.value = true
  try {
    const data = await $fetch<{ household: PlanningHousehold | null; budgetOverview: BudgetOverview | null }>(
      '/api/households/current',
    )
    currentHousehold.value = data.household
    budgetOverview.value = data.budgetOverview ?? null
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
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
      validFrom: budgetForm.value.validFrom ? formatDateInput(budgetForm.value.validFrom) : undefined,
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
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: 'DELETE',
      body: { kind: 'budget', id },
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
    eyebrow="Meilenstein 4 / Budgets"
    title="Budget pro Zeitraum"
    description="Plane, wie viel du pro Periode für einzelne Kategorien ausgeben willst. Die Progress-Bar zeigt, wie viel vom monatlichen Budget bereits verbraucht ist."
  >
    <template #summary>
      <Tag severity="info" :value="`Geplant ${formatMoney(budgetOverview?.plannedTotal ?? 0)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(budgetOverview?.spentTotal ?? 0)}`" />
      <Tag severity="success" :value="`Rest ${formatMoney(budgetOverview?.remainingTotal ?? 0)}`" />
    </template>

    <template #toolbar>
      <Button label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Budgetdaten werden geladen"
      loading-text="Wir holen den aktuellen Haushalt und die vorhandenen Budgets."
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold"
      variant="primary"
      compact
      :badge="`${currentHousehold.budgets.length} Einträge`"
    >
      <template #actions>
        <Button label="Neu" icon="pi pi-plus" severity="success" size="small" @click="openBudgetDialog" />
      </template>

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
          <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editBudget(budget)" />
          <Button
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            text
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
      <FormFieldRow label="Name" html-for="budget-name" wide>
        <InputText id="budget-name" v-model="budgetForm.name" placeholder="z. B. Lebensmittel" />
      </FormFieldRow>
      <FormFieldRow label="Betrag" html-for="budget-amount">
        <MoneyInput id="budget-amount" v-model="budgetForm.amount" :currency="currencyCode" />
      </FormFieldRow>
      <FormFieldRow label="Frequenz" html-for="budget-frequency">
        <Select
          id="budget-frequency"
          v-model="budgetForm.frequency"
          :options="frequencyOptions"
          optionLabel="label"
          optionValue="value"
        />
      </FormFieldRow>
      <FormFieldRow label="Gültig ab" html-for="budget-valid-from">
        <DatePicker id="budget-valid-from" v-model="budgetForm.validFrom" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
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
</style>