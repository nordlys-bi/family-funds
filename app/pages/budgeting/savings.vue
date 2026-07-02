<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

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
  savingsGoals: SavingsGoalItem[]
}

type Notice = { severity: 'success' | 'warn' | 'error'; text: string }
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
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)
const formatDate = (value: string | null) => {
  if (!value) return 'Offen'
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

const monthlySavingsRateTotal = computed(
  () => currentHousehold.value?.savingsGoals.reduce((sum, goal) => sum + goal.monthlyRate, 0) ?? 0,
)

const resetSavingsForm = () => {
  savingsForm.value = { name: '', targetAmount: '', monthlyRate: '', startDate: new Date(), endDate: null }
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

const openSavingsDialog = () => { resetSavingsForm(); savingsDialogOpen.value = true }
const closeSavingsDialog = () => { savingsDialogOpen.value = false; resetSavingsForm() }

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
    notice.value = { severity: 'success', text: isEdit ? 'Sparziel wurde aktualisiert.' : 'Sparziel wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Sparziel konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    savingsLoading.value = false
  }
}

const deletePlanningItem = async (id: string) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `savingsGoal:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: 'DELETE',
      body: { kind: 'savingsGoal', id },
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
    eyebrow="Meilenstein 4 / Savings"
    title="Sparziele"
    description="Definiere konkrete Sparziele mit Zielbetrag und monatlicher Rate."
  >
    <template #summary>
      <Tag severity="info" :value="`${currentHousehold?.savingsGoals.length ?? 0} Ziele`" />
      <Tag severity="success" :value="`${formatMoney(monthlySavingsRateTotal)}/Monat`" />
    </template>

    <template #toolbar>
      <Button label="Sparziel anlegen" icon="pi pi-plus" severity="success" @click="openSavingsDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Sparziele werden geladen"
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold"
      kicker="Sparziele"
      title="Auf dem Weg zum Zielbetrag"
      :badge="`${currentHousehold.savingsGoals.length} Einträge`"
    >
      <template #actions>
        <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openSavingsDialog" />
      </template>

      <ItemCard v-for="goal in currentHousehold.savingsGoals" :key="goal.id">
        <template #main>
          <div class="goal-row">
            <h3>{{ goal.name }}</h3>
            <span class="goal-pill">{{ formatMoney(goal.monthlyRate) }}/Monat</span>
          </div>
          <p>Ziel: {{ formatMoney(goal.targetAmount) }} · {{ formatDate(goal.startDate) }} bis {{ formatDate(goal.endDate) }}</p>
        </template>
        <template #actions>
          <Button label="Bearbeiten" icon="pi pi-pen-to-square" severity="secondary" outlined size="small" @click="editSavingsGoal(goal)" />
          <Button
            label="Löschen"
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            :loading="actionLoadingKey === `savingsGoal:${goal.id}`"
            @click="deletePlanningItem(goal.id)"
          />
        </template>
      </ItemCard>

      <div v-if="currentHousehold.savingsGoals.length === 0" class="empty-list">Noch keine Sparziele angelegt.</div>
    </ListPanel>

    <FormDialog
      v-model:visible="savingsDialogOpen"
      :header="savingsEditId ? 'Sparziel bearbeiten' : 'Sparziel anlegen'"
      :submit-label="savingsEditId ? 'Sparziel aktualisieren' : 'Sparziel anlegen'"
      :saving="savingsLoading"
      @save="saveSavingsGoal"
      @cancel="closeSavingsDialog"
      width="min(50rem, 94vw)"
    >
      <FormField label="Name" html-for="goal-name" wide>
        <InputText id="goal-name" v-model="savingsForm.name" placeholder="z. B. Urlaub" />
      </FormField>
      <FormField label="Zielbetrag" html-for="goal-target">
        <InputText id="goal-target" v-model="savingsForm.targetAmount" placeholder="0,00" inputmode="decimal" />
      </FormField>
      <FormField label="Monatliche Rate" html-for="goal-rate">
        <InputText id="goal-rate" v-model="savingsForm.monthlyRate" placeholder="0,00" inputmode="decimal" />
      </FormField>
      <FormField label="Start" html-for="goal-start">
        <DatePicker id="goal-start" v-model="savingsForm.startDate" showIcon dateFormat="dd.mm.yy" />
      </FormField>
      <FormField label="Ende" html-for="goal-end">
        <DatePicker id="goal-end" v-model="savingsForm.endDate" showIcon dateFormat="dd.mm.yy" />
      </FormField>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.goal-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.goal-pill {
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

.empty-list {
  padding: 1.1rem 1rem;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.16);
  color: #94a3b8;
  text-align: center;
  background: rgba(15, 23, 42, 0.36);
}
</style>