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

type IncomePlanItem = {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  createdAt: string
}

type FixedCostPlanItem = {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  createdAt: string
}

type SavingsGoalItem = {
  id: string
  name: string
  targetAmount: number
  monthlyRate: number
  startDate: string
  endDate: string | null
  createdAt: string
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
  incomePlans: IncomePlanItem[]
  fixedCosts: FixedCostPlanItem[]
  savingsGoals: SavingsGoalItem[]
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
const incomeLoading = ref(false)
const fixedCostLoading = ref(false)
const savingsLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const budgetDialogOpen = ref(false)
const incomeDialogOpen = ref(false)
const fixedCostDialogOpen = ref(false)
const savingsDialogOpen = ref(false)

const budgetForm = ref({
  name: '',
  amount: '',
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY') as DateFormValue,
})
const budgetEditId = ref<string | null>(null)

const incomeForm = ref({
  name: '',
  amount: '',
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const incomeEditId = ref<string | null>(null)

const fixedCostForm = ref({
  name: '',
  amount: '',
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const fixedCostEditId = ref<string | null>(null)

const savingsForm = ref({
  name: '',
  targetAmount: '',
  monthlyRate: '',
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const savingsEditId = ref<string | null>(null)

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

const monthlyFrequencyFactor = (frequency: Frequency) => {
  switch (frequency) {
    case 'WEEKLY':
      return 52 / 12
    case 'MONTHLY':
      return 1
    case 'QUARTERLY':
      return 1 / 3
    case 'YEARLY':
      return 1 / 12
    case 'ONCE':
      return 1
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

function parseDateInput(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
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

const resetIncomeForm = () => {
  incomeForm.value = {
    name: '',
    amount: '',
    frequency: 'MONTHLY',
    startDate: new Date(),
    endDate: null,
  }
  incomeEditId.value = null
}

const resetFixedCostForm = () => {
  fixedCostForm.value = {
    name: '',
    amount: '',
    frequency: 'MONTHLY',
    startDate: new Date(),
    endDate: null,
  }
  fixedCostEditId.value = null
}

const resetSavingsForm = () => {
  savingsForm.value = {
    name: '',
    targetAmount: '',
    monthlyRate: '',
    startDate: new Date(),
    endDate: null,
  }
  savingsEditId.value = null
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

const editIncomePlan = (plan: IncomePlanItem) => {
  incomeEditId.value = plan.id
  incomeForm.value = {
    name: plan.name,
    amount: (plan.amount / 100).toFixed(2).replace('.', ','),
    frequency: plan.frequency,
    startDate: new Date(plan.startDate),
    endDate: parseDateInput(plan.endDate),
  }
  incomeDialogOpen.value = true
}

const editFixedCostPlan = (plan: FixedCostPlanItem) => {
  fixedCostEditId.value = plan.id
  fixedCostForm.value = {
    name: plan.name,
    amount: (plan.amount / 100).toFixed(2).replace('.', ','),
    frequency: plan.frequency,
    startDate: new Date(plan.startDate),
    endDate: parseDateInput(plan.endDate),
  }
  fixedCostDialogOpen.value = true
}

const editSavingsGoal = (goal: SavingsGoalItem) => {
  savingsEditId.value = goal.id
  savingsForm.value = {
    name: goal.name,
    targetAmount: (goal.targetAmount / 100).toFixed(2).replace('.', ','),
    monthlyRate: (goal.monthlyRate / 100).toFixed(2).replace('.', ','),
    startDate: new Date(goal.startDate),
    endDate: parseDateInput(goal.endDate),
  }
  savingsDialogOpen.value = true
}

const openBudgetDialog = () => {
  resetBudgetForm()
  budgetDialogOpen.value = true
}

const openIncomeDialog = () => {
  resetIncomeForm()
  incomeDialogOpen.value = true
}

const openFixedCostDialog = () => {
  resetFixedCostForm()
  fixedCostDialogOpen.value = true
}

const openSavingsDialog = () => {
  resetSavingsForm()
  savingsDialogOpen.value = true
}

const closeBudgetDialog = () => {
  budgetDialogOpen.value = false
  resetBudgetForm()
}

const closeIncomeDialog = () => {
  incomeDialogOpen.value = false
  resetIncomeForm()
}

const closeFixedCostDialog = () => {
  fixedCostDialogOpen.value = false
  resetFixedCostForm()
}

const closeSavingsDialog = () => {
  savingsDialogOpen.value = false
  resetSavingsForm()
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

const saveIncomePlan = async () => {
  if (!activeHouseholdId.value) return

  incomeLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(incomeEditId.value)
    const payload = {
      kind: 'incomePlan',
      ...(incomeEditId.value ? { id: incomeEditId.value } : {}),
      name: incomeForm.value.name,
      amount: incomeForm.value.amount,
      frequency: incomeForm.value.frequency,
      startDate: incomeForm.value.startDate ? formatDateInput(incomeForm.value.startDate) : undefined,
      endDate: incomeForm.value.endDate ? formatDateInput(incomeForm.value.endDate) : null,
    }

    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: incomeEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })

    await loadPlanning()
    closeIncomeDialog()
    notice.value = {
      severity: 'success',
      text: isEdit ? 'Einnahmenplan wurde aktualisiert.' : 'Einnahmenplan wurde angelegt.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Einnahmenplan konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    incomeLoading.value = false
  }
}

const saveFixedCostPlan = async () => {
  if (!activeHouseholdId.value) return

  fixedCostLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(fixedCostEditId.value)
    const payload = {
      kind: 'fixedCostPlan',
      ...(fixedCostEditId.value ? { id: fixedCostEditId.value } : {}),
      name: fixedCostForm.value.name,
      amount: fixedCostForm.value.amount,
      frequency: fixedCostForm.value.frequency,
      startDate: fixedCostForm.value.startDate ? formatDateInput(fixedCostForm.value.startDate) : undefined,
      endDate: fixedCostForm.value.endDate ? formatDateInput(fixedCostForm.value.endDate) : null,
    }

    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: fixedCostEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })

    await loadPlanning()
    closeFixedCostDialog()
    notice.value = {
      severity: 'success',
      text: isEdit ? 'Fixkostenplan wurde aktualisiert.' : 'Fixkostenplan wurde angelegt.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Fixkostenplan konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    fixedCostLoading.value = false
  }
}

const saveSavingsGoal = async () => {
  if (!activeHouseholdId.value) return

  savingsLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(savingsEditId.value)
    const payload = {
      kind: 'savingsGoal',
      ...(savingsEditId.value ? { id: savingsEditId.value } : {}),
      name: savingsForm.value.name,
      targetAmount: savingsForm.value.targetAmount,
      monthlyRate: savingsForm.value.monthlyRate,
      startDate: savingsForm.value.startDate ? formatDateInput(savingsForm.value.startDate) : undefined,
      endDate: savingsForm.value.endDate ? formatDateInput(savingsForm.value.endDate) : null,
    }

    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: savingsEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })

    await loadPlanning()
    closeSavingsDialog()
    notice.value = {
      severity: 'success',
      text: isEdit ? 'Sparziel wurde aktualisiert.' : 'Sparziel wurde angelegt.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Sparziel konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    savingsLoading.value = false
  }
}

useDesktopShortcut('n', () => {
  if (!activeHouseholdId.value || budgetDialogOpen.value) return
  openBudgetDialog()
})

const deletePlanningItem = async (kind: 'budget' | 'incomePlan' | 'fixedCostPlan' | 'savingsGoal', id: string) => {
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

const monthlyEquivalent = (amount: number, frequency: Frequency) => {
  return Math.round(amount * monthlyFrequencyFactor(frequency))
}

const getLatestBudgetVersion = (budget: BudgetItem) => budget.versions[0] ?? null

const monthlyIncomeTotal = computed(
  () =>
    currentHousehold.value?.incomePlans.reduce(
      (sum, plan) => sum + monthlyEquivalent(plan.amount, plan.frequency),
      0,
    ) ?? 0,
)
const monthlyFixedCostTotal = computed(
  () =>
    currentHousehold.value?.fixedCosts.reduce(
      (sum, plan) => sum + monthlyEquivalent(plan.amount, plan.frequency),
      0,
    ) ?? 0,
)
const monthlySavingsRateTotal = computed(
  () => currentHousehold.value?.savingsGoals.reduce((sum, goal) => sum + goal.monthlyRate, 0) ?? 0,
)
const planableBalance = computed(() => monthlyIncomeTotal.value - monthlyFixedCostTotal.value - monthlySavingsRateTotal.value)
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
    eyebrow="Meilenstein 4"
    title="Budgetierung & Sparpläne"
    description="Verwalte Budgets, Einnahmenpläne, Fixkosten und Sparziele als getrennte Listen. Neue und bearbeitete Einträge öffnest du nur noch im Modal."
  >
    <template #summary>
      <Tag severity="info" :value="`Budget ${formatMoney(monthBudgetPlanned)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(monthBudgetSpent)}`" />
      <Tag severity="success" :value="`Restbudget ${formatMoney(monthBudgetBalance)}`" />
      <Tag severity="secondary" :value="`Spielraum ${formatMoney(planableBalance)}`" />
    </template>

    <template #toolbar>
      <div class="toolbar-note">
        <span class="toolbar-note__label">Neu</span>
        <Tag value="N" severity="secondary" rounded />
      </div>
      <Button label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <section v-if="loading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Planungsdaten werden geladen</h2>
        <p>Wir holen den aktuellen Haushalt und die vorhandenen Planungswerte.</p>
      </div>
    </section>

    <section v-else-if="!activeHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Erst dann können wir Budgets und Sparpläne anlegen.</p>
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

      <article class="plan-panel">
        <div class="panel-head">
          <div>
            <Kicker>Einnahmen</Kicker>
            <h2>Geplante Einnahmen</h2>
          </div>
          <div class="section-toolbar">
            <span class="panel-badge">{{ currentHousehold?.incomePlans.length ?? 0 }} Einträge</span>
            <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openIncomeDialog" />
          </div>
        </div>

        <div class="item-list">
          <article v-for="plan in currentHousehold?.incomePlans ?? []" :key="plan.id" class="item-card">
            <div class="item-main">
              <div class="item-title-row">
                <h3>{{ plan.name }}</h3>
                <span class="item-pill">{{ formatMoney(plan.amount) }}</span>
              </div>
              <p>{{ frequencyLabel(plan.frequency) }} · {{ formatDate(plan.startDate) }} bis {{ formatDate(plan.endDate) }}</p>
            </div>
            <div class="item-actions">
              <Button
                type="button"
                label="Bearbeiten"
                icon="pi pi-pen-to-square"
                severity="secondary"
                outlined
                size="small"
                @click="editIncomePlan(plan)"
              />
              <Button
                type="button"
                label="Löschen"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :loading="actionLoadingKey === `incomePlan:${plan.id}`"
                @click="deletePlanningItem('incomePlan', plan.id)"
              />
            </div>
          </article>

          <div v-if="(currentHousehold?.incomePlans ?? []).length === 0" class="empty-list">Noch keine Einnahmenpläne angelegt.</div>
        </div>
      </article>

      <article class="plan-panel">
        <div class="panel-head">
          <div>
            <Kicker>Fixkosten</Kicker>
            <h2>Regelmäßige Ausgaben</h2>
          </div>
          <div class="section-toolbar">
            <span class="panel-badge">{{ currentHousehold?.fixedCosts.length ?? 0 }} Einträge</span>
            <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openFixedCostDialog" />
          </div>
        </div>

        <div class="item-list">
          <article v-for="plan in currentHousehold?.fixedCosts ?? []" :key="plan.id" class="item-card">
            <div class="item-main">
              <div class="item-title-row">
                <h3>{{ plan.name }}</h3>
                <span class="item-pill">{{ formatMoney(plan.amount) }}</span>
              </div>
              <p>{{ frequencyLabel(plan.frequency) }} · {{ formatDate(plan.startDate) }} bis {{ formatDate(plan.endDate) }}</p>
            </div>
            <div class="item-actions">
              <Button
                type="button"
                label="Bearbeiten"
                icon="pi pi-pen-to-square"
                severity="secondary"
                outlined
                size="small"
                @click="editFixedCostPlan(plan)"
              />
              <Button
                type="button"
                label="Löschen"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :loading="actionLoadingKey === `fixedCostPlan:${plan.id}`"
                @click="deletePlanningItem('fixedCostPlan', plan.id)"
              />
            </div>
          </article>

          <div v-if="(currentHousehold?.fixedCosts ?? []).length === 0" class="empty-list">Noch keine Fixkostenpläne angelegt.</div>
        </div>
      </article>

      <article class="plan-panel plan-panel--wide">
        <div class="panel-head">
          <div>
            <Kicker>Sparziele</Kicker>
            <h2>Auf dem Weg zum Zielbetrag</h2>
          </div>
          <div class="section-toolbar">
            <span class="panel-badge">{{ currentHousehold?.savingsGoals.length ?? 0 }} Einträge</span>
            <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openSavingsDialog" />
          </div>
        </div>

        <div class="item-list item-list--goal">
          <article v-for="goal in currentHousehold?.savingsGoals ?? []" :key="goal.id" class="item-card">
            <div class="item-main">
              <div class="item-title-row">
                <h3>{{ goal.name }}</h3>
                <span class="item-pill">{{ formatMoney(goal.monthlyRate) }}/Monat</span>
              </div>
              <p>Ziel: {{ formatMoney(goal.targetAmount) }} · {{ formatDate(goal.startDate) }} bis {{ formatDate(goal.endDate) }}</p>
            </div>
            <div class="item-actions">
              <Button
                type="button"
                label="Bearbeiten"
                icon="pi pi-pen-to-square"
                severity="secondary"
                outlined
                size="small"
                @click="editSavingsGoal(goal)"
              />
              <Button
                type="button"
                label="Löschen"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :loading="actionLoadingKey === `savingsGoal:${goal.id}`"
                @click="deletePlanningItem('savingsGoal', goal.id)"
              />
            </div>
          </article>

          <div v-if="(currentHousehold?.savingsGoals ?? []).length === 0" class="empty-list">Noch keine Sparziele angelegt.</div>
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

    <Dialog
      v-model:visible="incomeDialogOpen"
      modal
      :header="incomeEditId ? 'Einnahmenplan bearbeiten' : 'Einnahmenplan anlegen'"
      :style="{ width: 'min(42rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeIncomeDialog"
    >
      <form class="plan-form" @submit.prevent="saveIncomePlan">
        <div class="field field--wide">
          <label for="income-name">Name</label>
          <InputText id="income-name" v-model="incomeForm.name" class="w-full" placeholder="z. B. Gehalt" />
        </div>
        <div class="field">
          <label for="income-amount">Betrag</label>
          <InputText
            id="income-amount"
            v-model="incomeForm.amount"
            class="w-full"
            placeholder="0,00"
            inputmode="decimal"
          />
        </div>
        <div class="field">
          <label for="income-frequency">Frequenz</label>
          <Select
            id="income-frequency"
            v-model="incomeForm.frequency"
            :options="frequencyOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="income-start">Start</label>
          <DatePicker
            id="income-start"
            v-model="incomeForm.startDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>
        <div class="field">
          <label for="income-end">Ende</label>
          <DatePicker
            id="income-end"
            v-model="incomeForm.endDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeIncomeDialog" />
          <Button
            type="submit"
            :label="incomeEditId ? 'Einnahmenplan aktualisieren' : 'Einnahmenplan anlegen'"
            icon="pi pi-check"
            :loading="incomeLoading"
          />
        </div>
      </form>
    </Dialog>

    <Dialog
      v-model:visible="fixedCostDialogOpen"
      modal
      :header="fixedCostEditId ? 'Fixkostenplan bearbeiten' : 'Fixkostenplan anlegen'"
      :style="{ width: 'min(42rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeFixedCostDialog"
    >
      <form class="plan-form" @submit.prevent="saveFixedCostPlan">
        <div class="field field--wide">
          <label for="fixed-name">Name</label>
          <InputText id="fixed-name" v-model="fixedCostForm.name" class="w-full" placeholder="z. B. Miete" />
        </div>
        <div class="field">
          <label for="fixed-amount">Betrag</label>
          <InputText
            id="fixed-amount"
            v-model="fixedCostForm.amount"
            class="w-full"
            placeholder="0,00"
            inputmode="decimal"
          />
        </div>
        <div class="field">
          <label for="fixed-frequency">Frequenz</label>
          <Select
            id="fixed-frequency"
            v-model="fixedCostForm.frequency"
            :options="frequencyOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="fixed-start">Start</label>
          <DatePicker
            id="fixed-start"
            v-model="fixedCostForm.startDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>
        <div class="field">
          <label for="fixed-end">Ende</label>
          <DatePicker
            id="fixed-end"
            v-model="fixedCostForm.endDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeFixedCostDialog" />
          <Button
            type="submit"
            :label="fixedCostEditId ? 'Fixkostenplan aktualisieren' : 'Fixkostenplan anlegen'"
            icon="pi pi-check"
            :loading="fixedCostLoading"
          />
        </div>
      </form>
    </Dialog>

    <Dialog
      v-model:visible="savingsDialogOpen"
      modal
      :header="savingsEditId ? 'Sparziel bearbeiten' : 'Sparziel anlegen'"
      :style="{ width: 'min(42rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeSavingsDialog"
    >
      <form class="plan-form plan-form--goal" @submit.prevent="saveSavingsGoal">
        <div class="field field--wide">
          <label for="goal-name">Name</label>
          <InputText id="goal-name" v-model="savingsForm.name" class="w-full" placeholder="z. B. Urlaub" />
        </div>
        <div class="field">
          <label for="goal-target">Zielbetrag</label>
          <InputText
            id="goal-target"
            v-model="savingsForm.targetAmount"
            class="w-full"
            placeholder="0,00"
            inputmode="decimal"
          />
        </div>
        <div class="field">
          <label for="goal-rate">Monatliche Rate</label>
          <InputText
            id="goal-rate"
            v-model="savingsForm.monthlyRate"
            class="w-full"
            placeholder="0,00"
            inputmode="decimal"
          />
        </div>
        <div class="field">
          <label for="goal-start">Start</label>
          <DatePicker
            id="goal-start"
            v-model="savingsForm.startDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>
        <div class="field">
          <label for="goal-end">Ende</label>
          <DatePicker
            id="goal-end"
            v-model="savingsForm.endDate"
            class="w-full"
            showIcon
            dateFormat="dd.mm.yy"
          />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeSavingsDialog" />
          <Button
            type="submit"
            :label="savingsEditId ? 'Sparziel aktualisieren' : 'Sparziel anlegen'"
            icon="pi pi-check"
            :loading="savingsLoading"
          />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.planning-page {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  animation: fadeIn 0.45s ease-out;
}

.planning-sections {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hero-panel,
.plan-panel,
.empty-state__card {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 28px;
  box-shadow:
    0 30px 80px rgba(2, 6, 23, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(18px);
}

.hero-panel {
  padding: 2rem;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.8fr);
  gap: 1.4rem;
}

.toolbar-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #cbd5e1;
}

.toolbar-note__label {
  font-size: 0.85rem;
  color: #94a3b8;
}

.hero-copy h1 {
  margin: 0;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.95;
  letter-spacing: -0.05em;
  color: #f8fafc;
}

.page-intro {
  margin: 1rem 0 0;
  max-width: 64ch;
  font-size: 1rem;
  line-height: 1.7;
  color: #94a3b8;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  align-content: start;
}

.stat-chip {
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(15, 23, 42, 0.9);
  min-height: 96px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.stat-chip--accent {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.18), rgba(15, 23, 42, 0.9));
  border-color: rgba(96, 165, 250, 0.28);
}

.stat-label {
  font-size: 0.82rem;
  color: #94a3b8;
}

.stat-chip strong {
  font-size: 1.45rem;
  color: #f8fafc;
}

.notice {
  margin-top: 1rem;
  border-radius: 16px;
  padding: 0.95rem 1rem;
  border: 1px solid transparent;
  font-weight: 600;
}

.notice--success {
  background: rgba(16, 185, 129, 0.12);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.2);
}

.notice--warn {
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.22);
}

.notice--error {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.24);
}

.planning-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;
}

.plan-panel {
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 100%;
}

.plan-panel--primary {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(9, 13, 22, 0.98));
}

.plan-panel--wide {
  grid-column: 1 / -1;
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

.plan-form--goal {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

/* Form-Field-Styles werden zentral in ~/assets/css/base.css verwaltet.
   Die frühere lokale Regel `.field input, .field select { padding: 0.95rem 1rem }`
   hat InputText/InputNumber/DatePicker-Input größer gemacht als Select, weil
   Select (div-basiert) nicht auf `input/select`-Selektoren matchte. */

.field input[type='date'] {
  color-scheme: dark;
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

.form-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: flex-end;
  grid-column: 1 / -1;
}

.form-actions--split {
  margin-top: 0.25rem;
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

.item-list--goal {
  margin-bottom: 0.15rem;
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

.button {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 14px;
  min-height: 44px;
  padding: 0.78rem 1rem;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #f8fafc;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease,
    opacity 0.18s ease;
}

.button:hover {
  transform: translateY(-1px);
}

.button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.button--primary {
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  box-shadow:
    0 18px 30px rgba(37, 99, 235, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: #ffffff;
}

.button--primary:hover {
  box-shadow:
    0 24px 36px rgba(37, 99, 235, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.button--ghost {
  background: rgba(30, 41, 59, 0.82);
  border-color: rgba(148, 163, 184, 0.24);
  color: #e2e8f0;
}

.button--ghost:hover {
  background: rgba(41, 55, 79, 0.92);
  border-color: rgba(148, 163, 184, 0.34);
}

.button--danger {
  background: rgba(127, 29, 29, 0.68);
  border-color: rgba(248, 113, 113, 0.22);
  color: #fecaca;
}

.button--danger:hover {
  background: rgba(153, 27, 27, 0.85);
}

.button--small {
  min-height: 38px;
  padding: 0.55rem 0.8rem;
  border-radius: 12px;
  font-size: 0.82rem;
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

@media (max-width: 1100px) {
  .hero-panel,
  .planning-grid {
    grid-template-columns: 1fr;
  }

  .plan-form--goal {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dialog-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .hero-panel,
  .plan-panel {
    padding: 1.2rem;
  }

  .hero-stats,
  .plan-form,
  .plan-form--goal {
    grid-template-columns: 1fr;
  }

  .item-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .item-actions,
  .form-actions {
    width: 100%;
    justify-content: stretch;
  }

  .form-actions {
    flex-direction: column-reverse;
  }

  .button {
    width: 100%;
  }
}
</style>
