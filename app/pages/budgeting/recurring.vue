<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Frequency, Notice } from '~/types/planning'

definePageMeta({ layout: 'default' })

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

import { isFirstRun } from '~/utils/household-age'

const { activeHousehold, fetchHouseholds } = useHousehold()
const confirm = useAskConfirm()

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
  startDate: new Date() as Date | null,
  endDate: null as Date | null,
})
const incomeEditId = ref<string | null>(null)

const fixedCostForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as Date | null,
  endDate: null as Date | null,
})
const fixedCostEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
// Beide Listen (incomePlans + fixedCosts) muessen leer sein, damit der
// First-Time-Empty greift — sonst waere es verwirrend, einen der beiden
// Bloecke zu zeigen mit "noch nichts da".
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const noRecurringPlans = computed(() => {
  const hh = currentHousehold.value
  if (!hh) return false
  return (hh.incomePlans?.length ?? 0) === 0 && (hh.fixedCosts?.length ?? 0) === 0
})
const showFirstTimeEmpty = computed(() => noRecurringPlans.value && isFirstRunHousehold.value)

const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)
const formatDate = formatPlanningDate

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
  incomeForm.value = { name: plan.name, amount: plan.amount / 100, frequency: plan.frequency, startDate: new Date(plan.startDate), endDate: parseDateInputString(plan.endDate) }
  incomeDialogOpen.value = true
}

const editFixedCostPlan = (plan: FixedCostPlanItem) => {
  fixedCostEditId.value = plan.id
  fixedCostForm.value = { name: plan.name, amount: plan.amount / 100, frequency: plan.frequency, startDate: new Date(plan.startDate), endDate: parseDateInputString(plan.endDate) }
  fixedCostDialogOpen.value = true
}

const openIncomeDialog = () => { resetIncomeForm(); incomeDialogOpen.value = true }
const openFixedCostDialog = () => { resetFixedCostForm(); fixedCostDialogOpen.value = true }
const closeIncomeDialog = () => { incomeDialogOpen.value = false; resetIncomeForm() }
const closeFixedCostDialog = () => { fixedCostDialogOpen.value = false; resetFixedCostForm() }

type PlanKind = 'incomePlan' | 'fixedCostPlan'

async function savePlan(
  kind: PlanKind,
  form: typeof incomeForm.value,
  editId: string | null,
  loadingRef: typeof incomeLoading,
  closeDialog: () => void,
  successVerb: string,
) {
  if (!activeHouseholdId.value) return
  loadingRef.value = true
  notice.value = null
  try {
    const isEdit = Boolean(editId)
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: {
        kind,
        ...(isEdit ? { id: editId } : {}),
        name: form.name,
        amount: form.amount,
        frequency: form.frequency,
        startDate: form.startDate ? formatDateToInputString(form.startDate) : undefined,
        endDate: form.endDate ? formatDateToInputString(form.endDate) : null,
      },
    })
    await loadPlanning()
    closeDialog()
    notice.value = { severity: 'success', text: isEdit ? `${successVerb} aktualisiert.` : `${successVerb} angelegt.` }
  } catch (error: any) {
    notice.value = { severity: 'error', text: `${successVerb} konnte nicht gespeichert werden: ` + (error.statusMessage || error.message) }
  } finally {
    loadingRef.value = false
  }
}

const saveIncomePlan = () => savePlan('incomePlan', incomeForm.value, incomeEditId.value, incomeLoading, closeIncomeDialog, 'Einnahmenplan')
const saveFixedCostPlan = () => savePlan('fixedCostPlan', fixedCostForm.value, fixedCostEditId.value, fixedCostLoading, closeFixedCostDialog, 'Fixkostenplan')

const deletePlanningItem = async (
  kind: 'incomePlan' | 'fixedCostPlan',
  plan: { id: string; name: string },
) => {
  if (!activeHouseholdId.value) return

  // ConfirmSheet (issue #51): geplante Einnahmen / Fixkosten haben kein
  // Undo (kein Soft-Delete wie Transaktionen). Confirm-Text nennt den
  // Plan-Namen und die Konsequenz (zukuenftige Hochrechnung faellt weg).
  const kindLabel = kind === 'incomePlan' ? 'Einnahmenplan' : 'Fixkostenplan'
  const ok = await confirm.ask({
    title: `${kindLabel} löschen?`,
    message: `„${plan.name}" wird endgültig entfernt. Die monatliche Hochrechnung wird zurückgerechnet — vergangene Buchungen bleiben unberührt.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  actionLoadingKey.value = `${kind}:${plan.id}`
  notice.value = null
  try {
    const endpoint = kind === 'incomePlan'
      ? `/api/households/${activeHouseholdId.value}/income-plans/${plan.id}`
      : `/api/households/${activeHouseholdId.value}/fixed-cost-plans/${plan.id}`
    await $fetch(endpoint, { method: 'DELETE' })
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

    <EmptyState
      v-if="!loading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-sync"
      icon-tone="accent"
      headline="Noch keine wiederkehrenden Posten"
      description="Plane z. B. dein Gehalt, deine Miete oder Versicherungen — so siehst du, was am Monatsende wirklich übrig bleibt."
      :cta="{ label: 'Plan anlegen', onClick: openIncomeDialog, severity: 'primary' }"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && noRecurringPlans"
      variant="no-data"
      icon="pi pi-sync"
      icon-tone="muted"
      headline="Keine Pläne"
      description="Lege einen Einnahmen- oder Fixkostenplan an, um Monats-Vorschauen zu sehen."
    />

    <!-- Beide ListPanels rendern unabhaengig — wenn nur eine der beiden
         Listen leer ist, zeigt der jeweilige Panel-Block den passenden
         Inline-Empty-Hinweis (v-if="length === 0" innerhalb des Panels). -->
    <template v-if="!loading && activeHousehold && currentHousehold && !noRecurringPlans">
      <ListPanel
        kicker="Einnahmen"
        title="Geplante Einnahmen"
        compact
        :badge="`${currentHousehold.incomePlans.length} Einträge`"
      >
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
            <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Einnahmenplan bearbeiten" @click="editIncomePlan(plan)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              text
              aria-label="Einnahmenplan löschen"
              :loading="actionLoadingKey === `incomePlan:${plan.id}`"
              @click="deletePlanningItem('incomePlan', plan)"
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
            <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Fixkostenplan bearbeiten" @click="editFixedCostPlan(plan)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              text
              aria-label="Fixkostenplan löschen"
              :loading="actionLoadingKey === `fixedCostPlan:${plan.id}`"
              @click="deletePlanningItem('fixedCostPlan', plan)"
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
      <RecurringPlanForm
        v-model="incomeForm"
        id-prefix="income"
        :currency="currencyCode"
        name-placeholder="z. B. Gehalt"
      />
    </FormDialog>

    <FormDialog
      v-model:visible="fixedCostDialogOpen"
      :header="fixedCostEditId ? 'Fixkostenplan bearbeiten' : 'Fixkostenplan anlegen'"
      :submit-label="fixedCostEditId ? 'Fixkostenplan aktualisieren' : 'Fixkostenplan anlegen'"
      :saving="fixedCostLoading"
      @save="saveFixedCostPlan"
      @cancel="closeFixedCostDialog"
    >
      <RecurringPlanForm
        v-model="fixedCostForm"
        id-prefix="fixed"
        :currency="currencyCode"
        name-placeholder="z. B. Miete"
      />
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