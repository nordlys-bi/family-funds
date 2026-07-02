<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({
  layout: 'default',
})

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
  budgets: unknown[]
  incomePlans: IncomePlanItem[]
  fixedCosts: FixedCostPlanItem[]
  savingsGoals: unknown[]
}

type Notice = {
  severity: 'success' | 'warn' | 'error'
  text: string
}

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

const loadPlanning = async () => {
  loading.value = true
  try {
    const data = await $fetch<{ household: PlanningHousehold | null }>(
      '/api/households/current',
    )
    currentHousehold.value = data.household
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    loading.value = false
  }
}

const monthlyEquivalent = (amount: number, frequency: Frequency) => {
  return Math.round(amount * monthlyFrequencyFactor(frequency))
}

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
const planableBalance = computed(() => monthlyIncomeTotal.value - monthlyFixedCostTotal.value)

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

const openIncomeDialog = () => {
  resetIncomeForm()
  incomeDialogOpen.value = true
}

const openFixedCostDialog = () => {
  resetFixedCostForm()
  fixedCostDialogOpen.value = true
}

const closeIncomeDialog = () => {
  incomeDialogOpen.value = false
  resetIncomeForm()
}

const closeFixedCostDialog = () => {
  fixedCostDialogOpen.value = false
  resetFixedCostForm()
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
    eyebrow="Meilenstein 4 / Recurring"
    title="Geplante Einnahmen & Fixkosten"
    description="Wiederkehrende Einnahmen (Gehalt, etc.) und Fixkosten (Miete, Verträge) als monatlich umgerechnete Pläne. So siehst du auf einen Blick, was am Ende des Monats übrig bleibt."
  >
    <template #summary>
      <Tag severity="success" :value="`Einnahmen ${formatMoney(monthlyIncomeTotal)}/Monat`" />
      <Tag severity="warning" :value="`Fixkosten ${formatMoney(monthlyFixedCostTotal)}/Monat`" />
      <Tag severity="info" :value="`Spielraum ${formatMoney(planableBalance)}/Monat`" />
    </template>

    <template #toolbar>
      <Button label="Einnahmenplan anlegen" icon="pi pi-plus" severity="success" @click="openIncomeDialog" />
      <Button label="Fixkostenplan anlegen" icon="pi pi-plus" severity="secondary" outlined @click="openFixedCostDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <section v-if="loading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Pläne werden geladen</h2>
        <p>Wir holen den aktuellen Haushalt und die vorhandenen Einnahmen- und Fixkostenpläne.</p>
      </div>
    </section>

    <section v-else-if="!activeHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Erst dann können wir Pläne anlegen.</p>
        <NuxtLink to="/households" class="empty-state__button">Zu den Haushalten</NuxtLink>
      </div>
    </section>

    <div v-else class="planning-sections">
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
    </div>

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