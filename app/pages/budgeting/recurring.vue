<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

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

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  incomePlans: IncomePlanItem[]
  fixedCosts: FixedCostPlanItem[]
}

type Notice = { severity: 'success' | 'warn' | 'error'; text: string }
type DateFormValue = Date | null

const { activeHousehold, fetchHouseholds } = useHousehold()

const currentHousehold = ref<PlanningHousehold | null>(null)
const loading = ref(false)
const notice = ref<Notice | null>(null)
const incomeLoading = ref(false)
const fixedCostLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const incomeDialogOpen = ref(false)
const fixedCostDialogOpen = ref(false)

const incomeForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const incomeEditId = ref<string | null>(null)

const fixedCostForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const fixedCostEditId = ref<string | null>(null)

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

function parseDateInput(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
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

const monthlyFrequencyFactor = (frequency: Frequency) => {
  switch (frequency) {
    case 'WEEKLY': return 52 / 12
    case 'MONTHLY': return 1
    case 'QUARTERLY': return 1 / 3
    case 'YEARLY': return 1 / 12
    case 'ONCE': return 1
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
    const data = await $fetch<{ household: PlanningHousehold | null }>('/api/households/current')
    currentHousehold.value = data.household
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

const monthlyEquivalent = (amount: number, frequency: Frequency) => Math.round(amount * monthlyFrequencyFactor(frequency))

const monthlyIncomeTotal = computed(
  () => currentHousehold.value?.incomePlans.reduce((sum, plan) => sum + monthlyEquivalent(plan.amount, plan.frequency), 0) ?? 0,
)
const monthlyFixedCostTotal = computed(
  () => currentHousehold.value?.fixedCosts.reduce((sum, plan) => sum + monthlyEquivalent(plan.amount, plan.frequency), 0) ?? 0,
)
const planableBalance = computed(() => monthlyIncomeTotal.value - monthlyFixedCostTotal.value)

const resetIncomeForm = () => {
  incomeForm.value = { name: '', amount: null, frequency: 'MONTHLY', startDate: new Date(), endDate: null }
  incomeEditId.value = null
}
const resetFixedCostForm = () => {
  fixedCostForm.value = { name: '', amount: null, frequency: 'MONTHLY', startDate: new Date(), endDate: null }
  fixedCostEditId.value = null
}

const editIncomePlan = (plan: IncomePlanItem) => {
  incomeEditId.value = plan.id
  incomeForm.value = {
    name: plan.name,
    amount: plan.amount / 100,
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
    amount: plan.amount / 100,
    frequency: plan.frequency,
    startDate: new Date(plan.startDate),
    endDate: parseDateInput(plan.endDate),
  }
  fixedCostDialogOpen.value = true
}

const openIncomeDialog = () => { resetIncomeForm(); incomeDialogOpen.value = true }
const openFixedCostDialog = () => { resetFixedCostForm(); fixedCostDialogOpen.value = true }
const closeIncomeDialog = () => { incomeDialogOpen.value = false; resetIncomeForm() }
const closeFixedCostDialog = () => { fixedCostDialogOpen.value = false; resetFixedCostForm() }

const saveIncomePlan = async () => {
  if (!activeHouseholdId.value) return
  incomeLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(incomeEditId.value)
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: {
        kind: 'incomePlan',
        ...(isEdit ? { id: incomeEditId.value } : {}),
        name: incomeForm.value.name,
        amount: incomeForm.value.amount,
        frequency: incomeForm.value.frequency,
        startDate: incomeForm.value.startDate ? formatDateInput(incomeForm.value.startDate) : undefined,
        endDate: incomeForm.value.endDate ? formatDateInput(incomeForm.value.endDate) : null,
      },
    })
    await loadPlanning()
    closeIncomeDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Einnahmenplan aktualisiert.' : 'Einnahmenplan angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahmenplan konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
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
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: {
        kind: 'fixedCostPlan',
        ...(isEdit ? { id: fixedCostEditId.value } : {}),
        name: fixedCostForm.value.name,
        amount: fixedCostForm.value.amount,
        frequency: fixedCostForm.value.frequency,
        startDate: fixedCostForm.value.startDate ? formatDateInput(fixedCostForm.value.startDate) : undefined,
        endDate: fixedCostForm.value.endDate ? formatDateInput(fixedCostForm.value.endDate) : null,
      },
    })
    await loadPlanning()
    closeFixedCostDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Fixkostenplan aktualisiert.' : 'Fixkostenplan angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Fixkostenplan konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    fixedCostLoading.value = false
  }
}

const deletePlanningItem = async (kind: 'incomePlan' | 'fixedCostPlan', id: string) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `${kind}:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: 'DELETE',
      body: { kind, id },
    })
    await loadPlanning()
    notice.value = { severity: 'success', text: 'Eintrag wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Eintrag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadPlanning()
})
watch(activeHouseholdId, async () => { await loadPlanning() })
</script>

<template>
  <ListPageShell
    eyebrow="Meilenstein 4 / Recurring"
    title="Geplante Einnahmen & Fixkosten"
    description="Wiederkehrende Einnahmen und Fixkosten als monatlich umgerechnete Pläne."
  >
    <template #summary>
      <Tag severity="success" :value="`Einnahmen ${formatMoney(monthlyIncomeTotal)} / Monat`" />
      <Tag severity="warning" :value="`Fixkosten ${formatMoney(monthlyFixedCostTotal)} / Monat`" />
      <Tag severity="info" :value="`Spielraum ${formatMoney(planableBalance)} / Monat`" />
    </template>

    <template #toolbar>
      <Button label="Einnahmenplan" icon="pi pi-plus" severity="success" @click="openIncomeDialog" />
      <Button label="Fixkostenplan" icon="pi pi-plus" severity="secondary" outlined @click="openFixedCostDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Pläne werden geladen"
    />

    <template v-if="!loading && activeHousehold && currentHousehold">
      <ListPanel
        kicker="Einnahmen"
        title="Geplante Einnahmen"
        compact
        :badge="`${currentHousehold.incomePlans.length} Einträge`"
      >
        <template #actions>
          <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openIncomeDialog" />
        </template>

        <ItemCard v-for="plan in currentHousehold.incomePlans" :key="plan.id">
          <template #main>
            <span class="row-title">
              {{ plan.name }}
              <span class="row-tag row-tag--green">+ {{ formatMoney(monthlyEquivalent(plan.amount, plan.frequency)) }} / Mo</span>
            </span>
            <span class="row-sub">
              <span class="row-tag">{{ frequencyLabel(plan.frequency) }}</span>
              <span>{{ formatDate(plan.startDate) }} – {{ formatDate(plan.endDate) }}</span>
            </span>
          </template>
          <template #aside>
            <div>
              {{ formatMoney(plan.amount) }}
              <span class="amount-secondary">pro {{ frequencyLabel(plan.frequency) }}</span>
            </div>
          </template>
          <template #actions>
            <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editIncomePlan(plan)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              text
              :loading="actionLoadingKey === `incomePlan:${plan.id}`"
              @click="deletePlanningItem('incomePlan', plan.id)"
            />
          </template>
        </ItemCard>

        <div v-if="currentHousehold.incomePlans.length === 0" class="empty-list">Noch keine Einnahmenpläne angelegt.</div>
      </ListPanel>

      <ListPanel
        kicker="Fixkosten"
        title="Regelmäßige Ausgaben"
        compact
        :badge="`${currentHousehold.fixedCosts.length} Einträge`"
      >
        <template #actions>
          <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openFixedCostDialog" />
        </template>

        <ItemCard v-for="plan in currentHousehold.fixedCosts" :key="plan.id">
          <template #main>
            <span class="row-title">
              {{ plan.name }}
              <span class="row-tag row-tag--warning">− {{ formatMoney(monthlyEquivalent(plan.amount, plan.frequency)) }} / Mo</span>
            </span>
            <span class="row-sub">
              <span class="row-tag">{{ frequencyLabel(plan.frequency) }}</span>
              <span>{{ formatDate(plan.startDate) }} – {{ formatDate(plan.endDate) }}</span>
            </span>
          </template>
          <template #aside>
            <div>
              {{ formatMoney(plan.amount) }}
              <span class="amount-secondary">pro {{ frequencyLabel(plan.frequency) }}</span>
            </div>
          </template>
          <template #actions>
            <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editFixedCostPlan(plan)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              text
              :loading="actionLoadingKey === `fixedCostPlan:${plan.id}`"
              @click="deletePlanningItem('fixedCostPlan', plan.id)"
            />
          </template>
        </ItemCard>

        <div v-if="currentHousehold.fixedCosts.length === 0" class="empty-list">Noch keine Fixkostenpläne angelegt.</div>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="incomeDialogOpen"
      :header="incomeEditId ? 'Einnahmenplan bearbeiten' : 'Einnahmenplan anlegen'"
      :submit-label="incomeEditId ? 'Einnahmenplan aktualisieren' : 'Einnahmenplan anlegen'"
      :saving="incomeLoading"
      @save="saveIncomePlan"
      @cancel="closeIncomeDialog"
    >
      <FormFieldRow label="Name" html-for="income-name" wide>
        <InputText id="income-name" v-model="incomeForm.name" placeholder="z. B. Gehalt" />
      </FormFieldRow>
      <FormFieldRow label="Betrag" html-for="income-amount">
        <MoneyInput id="income-amount" v-model="incomeForm.amount" :currency="currencyCode" />
      </FormFieldRow>
      <FormFieldRow label="Frequenz" html-for="income-frequency">
        <Select id="income-frequency" v-model="incomeForm.frequency" :options="frequencyOptions" optionLabel="label" optionValue="value" />
      </FormFieldRow>
      <FormFieldRow label="Start" html-for="income-start">
        <DatePicker id="income-start" v-model="incomeForm.startDate" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
      <FormFieldRow label="Ende" html-for="income-end">
        <DatePicker id="income-end" v-model="incomeForm.endDate" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
    </FormDialog>

    <FormDialog
      v-model:visible="fixedCostDialogOpen"
      :header="fixedCostEditId ? 'Fixkostenplan bearbeiten' : 'Fixkostenplan anlegen'"
      :submit-label="fixedCostEditId ? 'Fixkostenplan aktualisieren' : 'Fixkostenplan anlegen'"
      :saving="fixedCostLoading"
      @save="saveFixedCostPlan"
      @cancel="closeFixedCostDialog"
    >
      <FormFieldRow label="Name" html-for="fixed-name" wide>
        <InputText id="fixed-name" v-model="fixedCostForm.name" placeholder="z. B. Miete" />
      </FormFieldRow>
      <FormFieldRow label="Betrag" html-for="fixed-amount">
        <MoneyInput id="fixed-amount" v-model="fixedCostForm.amount" :currency="currencyCode" />
      </FormFieldRow>
      <FormFieldRow label="Frequenz" html-for="fixed-frequency">
        <Select id="fixed-frequency" v-model="fixedCostForm.frequency" :options="frequencyOptions" optionLabel="label" optionValue="value" />
      </FormFieldRow>
      <FormFieldRow label="Start" html-for="fixed-start">
        <DatePicker id="fixed-start" v-model="fixedCostForm.startDate" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
      <FormFieldRow label="Ende" html-for="fixed-end">
        <DatePicker id="fixed-end" v-model="fixedCostForm.endDate" showIcon dateFormat="dd.mm.yy" />
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

.row-tag--green {
  background: rgba(52, 211, 153, 0.16);
  color: #34d399;
}

.row-tag--warning {
  background: rgba(251, 191, 36, 0.16);
  color: #fbbf24;
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