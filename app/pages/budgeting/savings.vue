<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({
  layout: 'default',
})

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

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
  budgets: unknown[]
  incomePlans: unknown[]
  fixedCosts: unknown[]
  savingsGoals: SavingsGoalItem[]
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
const savingsLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const savingsDialogOpen = ref(false)

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

const monthlySavingsRateTotal = computed(
  () => currentHousehold.value?.savingsGoals.reduce((sum, goal) => sum + goal.monthlyRate, 0) ?? 0,
)

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

const openSavingsDialog = () => {
  resetSavingsForm()
  savingsDialogOpen.value = true
}

const closeSavingsDialog = () => {
  savingsDialogOpen.value = false
  resetSavingsForm()
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

const deletePlanningItem = async (kind: 'savingsGoal', id: string) => {
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
    eyebrow="Meilenstein 4 / Savings"
    title="Sparziele"
    description="Definiere konkrete Sparziele mit Zielbetrag und monatlicher Rate. So weisst du, wie viel du pro Monat zur Seite legen musst, um rechtzeitig anzukommen."
  >
    <template #summary>
      <Tag severity="info" :value="`${currentHousehold?.savingsGoals.length ?? 0} Ziele`" />
      <Tag severity="success" :value="`${formatMoney(monthlySavingsRateTotal)}/Monat`" />
    </template>

    <template #toolbar>
      <Button label="Sparziel anlegen" icon="pi pi-plus" severity="success" @click="openSavingsDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <section v-if="loading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Sparziele werden geladen</h2>
        <p>Wir holen den aktuellen Haushalt und die vorhandenen Sparziele.</p>
      </div>
    </section>

    <section v-else-if="!activeHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Erst dann können wir Sparziele anlegen.</p>
        <NuxtLink to="/households" class="empty-state__button">Zu den Haushalten</NuxtLink>
      </div>
    </section>

    <div v-else class="planning-sections">
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

@media (max-width: 1100px) {
  .plan-form--goal {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .plan-panel {
    padding: 1.2rem;
  }

  .plan-form,
  .plan-form--goal {
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