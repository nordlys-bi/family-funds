<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({
  layout: 'default',
})

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

type BudgetVersionItem = {
  id: string
  amount: number
  frequency: Frequency
  validFrom: string
  createdAt: string
  updatedAt: string
}

type BudgetItem = {
  id: string
  key: string
  name: string
  createdAt: string
  updatedAt: string
  versions: BudgetVersionItem[]
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
  unassigned: {
    name: string
    spentAmount: number
    remainingAmount: number
  }
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
  incomePlans: unknown[]
  fixedCosts: unknown[]
  savingsGoals: unknown[]
}

type Notice = {
  severity: 'success' | 'warn' | 'error'
  text: string
}

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
  () =>
    new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currencyCode.value,
    }),
)

const frequencyLabel = (frequency: Frequency) => {
  switch (frequency) {
    case 'WEEKLY':
      return 'Wöchentlich'
    case 'MONTHLY':
      return 'Monatlich'
    case 'QUARTERLY':
      return 'Quartalsweise'
    case 'YEARLY':
      return 'Jährlich'
    case 'ONCE':
      return 'Einmalig'
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

const deletePlanningItem = async (kind: 'budget', id: string) => {
  if (!activeHouseholdId.value) return

  actionLoadingKey.value = `${kind}:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: 'DELETE',
      body: { kind, id },
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
  () =>
    new Map(
      budgetOverview.value?.budgets.map((item) => [item.budgetId, item] as const) ?? [],
    ),
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

    <section v-if="loading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Budgetdaten werden geladen</h2>
        <p>Wir holen den aktuellen Haushalt und die vorhandenen Budgets.</p>
      </div>
    </section>

    <section v-else-if="!activeHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Erst dann können wir Budgets anlegen.</p>
        <NuxtLink to="/households" class="empty-state__button">Zu den Haushalten</NuxtLink>
      </div>
    </section>

    <div v-else class="planning-sections">
      <article class="plan-panel plan-panel--primary">
        <div class="panel-head">
          <div>
            <Kicker>Budget</Kicker>
            <h2>Budget pro Zeitraum</h2>
          </div>
          <div class="section-toolbar">
            <span class="panel-badge">{{ currentHousehold?.budgets.length ?? 0 }} Einträge</span>
            <Button label="Neu" icon="pi pi-plus" severity="success" size="small" @click="openBudgetDialog" />
          </div>
        </div>

        <div class="item-list">
          <article v-for="budget in currentHousehold?.budgets ?? []" :key="budget.id" class="item-card">
            <div class="item-main">
              <div class="item-title-row">
                <h3>{{ budget.name }}</h3>
                <span class="item-pill">{{ formatMoney(getBudgetOverviewItem(budget.id)?.plannedAmount ?? 0) }}</span>
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
            </div>
            <div class="item-actions">
              <Button
                type="button"
                label="Bearbeiten"
                icon="pi pi-pen-to-square"
                severity="secondary"
                outlined
                size="small"
                @click="editBudget(budget)"
              />
              <Button
                type="button"
                label="Löschen"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :loading="actionLoadingKey === `budget:${budget.id}`"
                @click="deletePlanningItem('budget', budget.id)"
              />
            </div>
          </article>

          <div v-if="(currentHousehold?.budgets ?? []).length === 0" class="empty-list">Noch keine Budgets angelegt.</div>
          <article v-if="budgetOverview" class="item-card">
            <div class="item-main">
              <div class="item-title-row">
                <h3>{{ budgetOverview.unassigned.name }}</h3>
                <span class="item-pill">{{ formatMoney(budgetOverview.unassigned.spentAmount) }}</span>
              </div>
              <p>Virtuelle Kategorie für Ausgaben ohne Budgetzuordnung.</p>
              <p class="budget-metrics">
                Verbraucht {{ formatMoney(budgetOverview.unassigned.spentAmount) }}
                · Rest {{ formatMoney(budgetOverview.unassigned.remainingAmount) }}
              </p>
            </div>
          </article>
        </div>
      </article>
    </div>

    <Dialog
      v-model:visible="budgetDialogOpen"
      modal
      :header="budgetEditId ? 'Budget bearbeiten' : 'Budget anlegen'"
      :style="{ width: 'min(42rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeBudgetDialog"
    >
      <form class="plan-form" @submit.prevent="saveBudget">
        <div class="field field--wide">
          <label for="budget-name">Name</label>
          <InputText
            id="budget-name"
            v-model="budgetForm.name"
            class="w-full"
            placeholder="z. B. Lebensmittel"
          />
        </div>
        <div class="field">
          <label for="budget-amount">Betrag</label>
          <InputText
            id="budget-amount"
            v-model="budgetForm.amount"
            class="w-full"
            placeholder="0,00"
            inputmode="decimal"
          />
        </div>
        <div class="field">
          <label for="budget-frequency">Frequenz</label>
          <Select
            id="budget-frequency"
            v-model="budgetForm.frequency"
            :options="frequencyOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="budget-valid-from">Gültig ab</label>
          <DatePicker
            id="budget-valid-from"
            v-model="budgetForm.validFrom"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeBudgetDialog" />
          <Button
            type="submit"
            :label="budgetEditId ? 'Budget aktualisieren' : 'Budget anlegen'"
            icon="pi pi-check"
            :loading="budgetLoading"
          />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.planning-sections {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.plan-panel {
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 100%;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 28px;
  box-shadow:
    0 30px 80px rgba(2, 6, 23, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.plan-panel--primary {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(9, 13, 22, 0.98));
}

.section-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.panel-head h2 {
  margin: 0;
  font-size: 1.35rem;
  color: #f8fafc;
  letter-spacing: -0.03em;
}

.panel-badge {
  flex-shrink: 0;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(30, 41, 59, 0.9);
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 700;
}

.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.95rem;
  padding: 1rem;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.24);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.field--wide {
  grid-column: 1 / -1;
}

.field label {
  font-size: 0.84rem;
  font-weight: 700;
  color: #e2e8f0;
}

:deep(.p-inputtext),
:deep(.p-select),
:deep(.p-datepicker),
:deep(.p-inputnumber) {
  width: 100%;
}

:deep(.p-button) {
  border-radius: 14px;
}

.dialog-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  grid-column: 1 / -1;
  margin-top: 0.25rem;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.82);
}

.item-main {
  min-width: 0;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.item-title-row h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.item-main p {
  margin: 0.35rem 0 0;
  color: #94a3b8;
  font-size: 0.88rem;
}

.budget-metrics {
  color: #cbd5e1;
}

.item-pill {
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

.item-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.empty-list {
  padding: 1.1rem 1rem;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.16);
  color: #94a3b8;
  text-align: center;
  background: rgba(15, 23, 42, 0.36);
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
}

.empty-state__card {
  width: min(640px, 100%);
  padding: 2rem;
  text-align: center;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 28px;
}

.empty-state__card h2 {
  margin: 0;
  font-size: 1.7rem;
  color: #f8fafc;
}

.empty-state__card p {
  margin: 0.75rem auto 0;
  max-width: 48ch;
  color: #94a3b8;
  line-height: 1.65;
}

.empty-state__button {
  display: inline-flex;
  margin-top: 1.2rem;
  padding: 0.85rem 1.1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
  text-decoration: none;
  font-weight: 800;
}

@media (max-width: 720px) {
  .plan-panel {
    padding: 1.2rem;
  }

  .plan-form {
    grid-template-columns: 1fr;
  }

  .item-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .item-actions {
    width: 100%;
    justify-content: stretch;
  }
}
</style>