<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Frequency, Notice } from '~/types/planning'
import { todayDateHelperText } from '~/utils/form-helpers'

definePageMeta({ layout: 'default' })

// Issue #59: Coverage-Felder pro Plan. Server liefert pro Plan
// { due, paid, percent } + nextDueDate (ISO string | null).
type PlanCoverage = {
  due: number
  paid: number
  percent: number
}

type IncomePlanItem = {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  createdAt: string
  coverage: PlanCoverage
  nextDueDate: string | null
}

type FixedCostPlanItem = {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  createdAt: string
  coverage: PlanCoverage
  nextDueDate: string | null
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

// === Issue #59: Coverage-Status + ?showAll=1 Override =====================

const route = useRoute()
const router = useRouter()
const showAll = computed(() => route.query.showAll === '1')

/**
 * Severity-Mapping fuer den Coverage-Tag. Prozentwerte nahe 100 sind
 * "gut" (success), knapp drunter "warn", weit drunter "danger".
 * Ein Plan mit due=0 ist "nicht relevant" (kein Tag).
 */
function severityForPercent(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 100) return 'success'
  if (percent >= 50) return 'warning'
  return 'danger'
}

/**
 * Non-Due-Plan: ein Plan, der im aktuellen Monat keine Faelligkeit
 * hat (due=0). Wird per Default ausgeblendet, ausser der User hat
 * explizit ?showAll=1 gesetzt.
 */
function isNonDue(plan: { coverage: PlanCoverage }): boolean {
  return plan.coverage.due === 0
}

/**
 * Filtert Non-Due-Plaene raus, wenn showAll false ist. Frontend
 * entscheidet das hier, damit der Server die Plaene trotzdem liefert
 * (fuer den Toggle am Listenende brauchen wir die Anzahl).
 */
function visiblePlans<P extends { coverage: PlanCoverage }>(plans: P[]): P[] {
  if (showAll.value) return plans
  return plans.filter((plan) => !isNonDue(plan))
}

const nonDueIncomeCount = computed(
  () => currentHousehold.value?.incomePlans.filter((plan) => isNonDue(plan)).length ?? 0,
)
const nonDueFixedCount = computed(
  () => currentHousehold.value?.fixedCosts.filter((plan) => isNonDue(plan)).length ?? 0,
)
const nonDueCount = computed(() => nonDueIncomeCount.value + nonDueFixedCount.value)

async function toggleShowAll() {
  const query = { ...route.query }
  if (showAll.value) {
    delete query.showAll
  } else {
    query.showAll = '1'
  }
  await router.replace({ query })
}

// === Issue #59: "Als bezahlt/erhalten markieren"-Flow ===================

/**
 * Mark-Paid-Dialog-State. Eine einzige Dialog-Instanz, beide Plan-Typen
 * (fixedCost/income) gehen durch denselben Flow. Der `kind` und der
 * `planId` werden beim Oeffnen gesetzt.
 */
type MarkKind = 'fixedCost' | 'income'
const markDialogOpen = ref(false)
const markKind = ref<MarkKind>('fixedCost')
const markPlanId = ref<string | null>(null)
const markLoading = ref(false)
const markError = ref<string | null>(null)

const markForm = ref({
  amount: null as number | null,
  date: new Date() as Date | null,
  description: '',
})

const markPlan = computed(() => {
  if (!markPlanId.value) return null
  if (markKind.value === 'fixedCost') {
    return currentHousehold.value?.fixedCosts.find((p) => p.id === markPlanId.value) ?? null
  }
  return currentHousehold.value?.incomePlans.find((p) => p.id === markPlanId.value) ?? null
})

const markPlanName = computed(() => markPlan.value?.name ?? '')
const markDialogHeader = computed(() => {
  if (markKind.value === 'fixedCost') return 'Fixkosten als bezahlt markieren'
  return 'Einnahmen als erhalten markieren'
})
const markSubmitLabel = computed(() => {
  if (markKind.value === 'fixedCost') return 'Bezahlt markieren'
  return 'Erhalten markieren'
})
const markSubmitSeverity = computed<'success' | 'primary'>(() =>
  markKind.value === 'fixedCost' ? 'primary' : 'success',
)

function openMarkDialog(kind: MarkKind, planId: string) {
  const plan = kind === 'fixedCost'
    ? currentHousehold.value?.fixedCosts.find((p) => p.id === planId)
    : currentHousehold.value?.incomePlans.find((p) => p.id === planId)
  if (!plan) return
  markKind.value = kind
  markPlanId.value = planId
  markForm.value = {
    amount: plan.amount / 100,
    date: new Date(),
    // Issue #59 polish: Notiz mit dem Plannamen vorbelegen. Macht
    // die spaetere Buchung in der Transaktionsliste sofort
    // wiedererkennbar ("Miete" statt "Ausgabe"). User kann
    // editieren (z. B. "Miete + Nebenkosten"), Default ist der
    // Planname pur.
    description: plan.name,
  }
  markError.value = null
  markDialogOpen.value = true
}

function closeMarkDialog() {
  markDialogOpen.value = false
  markPlanId.value = null
  markError.value = null
  markForm.value = { amount: null, date: new Date(), description: '' }
}

async function submitMarkDialog() {
  if (!activeHouseholdId.value || !markPlanId.value || !markForm.value.amount) {
    markError.value = 'Betrag und Datum sind erforderlich.'
    return
  }
  if (markForm.value.amount <= 0) {
    markError.value = 'Betrag muss groesser als 0 sein.'
    return
  }
  markLoading.value = true
  markError.value = null
  try {
    const isExpense = markKind.value === 'fixedCost'
    const payload: Record<string, unknown> = {
      kind: isExpense ? 'expense' : 'income',
      amount: markForm.value.amount,
      date: markForm.value.date ? formatDateToInputString(markForm.value.date) : formatDateToInputString(new Date()),
      description: markForm.value.description.trim() || null,
    }
    // Issue #59 polish: kein Budget-Override im Mark-Dialog mehr.
    // Die Transaktion wird mit budgetId=null angelegt. Falls der User
    // doch ein Budget zuordnen will, macht er das im Transaction-Row-
    // Editor auf der Expenses-Liste. Recurring und Budget sind
    // bewusst orthogonale Konzepte.
    if (isExpense) {
      payload.fixedCostPlanId = markPlanId.value
    } else {
      payload.incomePlanId = markPlanId.value
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'POST',
      body: payload,
    })
    await loadPlanning()
    const verb = isExpense ? 'bezahlt markiert' : 'erhalten markiert'
    notice.value = {
      severity: 'success',
      text: `${markPlanName.value} wurde als ${verb}.`,
    }
    closeMarkDialog()
  } catch (error: any) {
    markError.value = error?.statusMessage || error?.message || 'Speichern fehlgeschlagen.'
  } finally {
    markLoading.value = false
  }
}

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
        :badge="`${visiblePlans(currentHousehold.incomePlans).length} fällig${nonDueIncomeCount > 0 ? ` · ${nonDueIncomeCount} diesen Monat nicht relevant` : ''}`"
      >
        <ItemCard v-for="plan in visiblePlans(currentHousehold.incomePlans)" :key="plan.id">
          <template #main>
            <span class="row-title">
              {{ plan.name }}
              <span class="row-tag row-tag--green">+ {{ formatMoney(monthlyEquivalent(plan.amount, plan.frequency)) }} / Mo</span>
            </span>
            <span class="row-sub">
              <span class="row-tag">{{ frequencyLabel(plan.frequency) }}</span>
              <span>{{ formatDate(plan.startDate) }} – {{ formatDate(plan.endDate) }}</span>
              <!-- Issue #59: Coverage-Tag. Wird nur gerendert, wenn
                   der Plan in diesem Monat fällig ist (due > 0). -->
              <span
                v-if="plan.coverage.due > 0"
                class="row-tag"
                :class="{
                  'row-tag--green': severityForPercent(plan.coverage.percent) === 'success',
                  'row-tag--warn': severityForPercent(plan.coverage.percent) === 'warning',
                  'row-tag--danger': severityForPercent(plan.coverage.percent) === 'danger',
                }"
                :title="`${plan.coverage.paid} von ${plan.coverage.due} fällig (${plan.coverage.percent}%)`"
              >
                {{ plan.coverage.paid }} / {{ plan.coverage.due }}
                <span class="row-tag__hint">{{ plan.coverage.percent.toFixed(0) }}%</span>
              </span>
            </span>
          </template>
          <template #aside>
            <div>
              {{ formatMoney(plan.amount) }}
              <span class="amount-secondary">pro {{ frequencyLabel(plan.frequency) }}</span>
            </div>
          </template>
          <template #actions>
            <!-- Issue #59: "Als erhalten markieren" nur, wenn der Plan
                 in diesem Monat fällig ist. Non-Due-Plaene bekommen
                 den Button nicht (sonst wäre der Klick irreführend). -->
            <Button
              v-if="plan.coverage.due > 0 && plan.coverage.percent < 100"
              icon="pi pi-check-circle"
              severity="success"
              text
              size="small"
              aria-label="Einnahmen als erhalten markieren"
              @click="openMarkDialog('income', plan.id)"
            />
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
        :badge="`${visiblePlans(currentHousehold.fixedCosts).length} fällig${nonDueFixedCount > 0 ? ` · ${nonDueFixedCount} diesen Monat nicht relevant` : ''}`"
      >
        <ItemCard v-for="plan in visiblePlans(currentHousehold.fixedCosts)" :key="plan.id">
          <template #main>
            <span class="row-title">
              {{ plan.name }}
              <span class="row-tag row-tag--warning">− {{ formatMoney(monthlyEquivalent(plan.amount, plan.frequency)) }} / Mo</span>
            </span>
            <span class="row-sub">
              <span class="row-tag">{{ frequencyLabel(plan.frequency) }}</span>
              <span>{{ formatDate(plan.startDate) }} – {{ formatDate(plan.endDate) }}</span>
              <span
                v-if="plan.coverage.due > 0"
                class="row-tag"
                :class="{
                  'row-tag--green': severityForPercent(plan.coverage.percent) === 'success',
                  'row-tag--warn': severityForPercent(plan.coverage.percent) === 'warning',
                  'row-tag--danger': severityForPercent(plan.coverage.percent) === 'danger',
                }"
                :title="`${plan.coverage.paid} von ${plan.coverage.due} fällig (${plan.coverage.percent}%)`"
              >
                {{ plan.coverage.paid }} / {{ plan.coverage.due }}
                <span class="row-tag__hint">{{ plan.coverage.percent.toFixed(0) }}%</span>
              </span>
            </span>
          </template>
          <template #aside>
            <div>
              {{ formatMoney(plan.amount) }}
              <span class="amount-secondary">pro {{ frequencyLabel(plan.frequency) }}</span>
            </div>
          </template>
          <template #actions>
            <Button
              v-if="plan.coverage.due > 0 && plan.coverage.percent < 100"
              icon="pi pi-check-circle"
              severity="primary"
              text
              size="small"
              aria-label="Fixkosten als bezahlt markieren"
              @click="openMarkDialog('fixedCost', plan.id)"
            />
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

      <!-- Issue #59: Toggle fuer Non-Due-Plaene. Wird nur gezeigt,
           wenn ueberhaupt welche existieren UND wir sie nicht schon
           per ?showAll=1 zeigen. -->
      <button
        v-if="nonDueCount > 0"
        type="button"
        class="recurring-showall"
        @click="toggleShowAll"
      >
        <i :class="['pi', showAll ? 'pi-eye-slash' : 'pi-eye', 'recurring-showall__icon']" aria-hidden="true" />
        {{ showAll
          ? `Weniger anzeigen (${nonDueCount} ausgeblendete Pläne wieder verstecken)`
          : `${nonDueCount} Pläne diesen Monat nicht relevant anzeigen` }}
      </button>
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

    <!-- Issue #59: FormDialog fuer "Als bezahlt/erhalten markieren".
         Eine Instanz, beide Plan-Typen (kind steuert die Felder). -->
    <FormDialog
      v-model:visible="markDialogOpen"
      :header="markDialogHeader"
      :submit-label="markSubmitLabel"
      :submit-severity="markSubmitSeverity"
      :saving="markLoading"
      width="min(38rem, 94vw)"
      @save="submitMarkDialog"
      @cancel="closeMarkDialog"
    >
      <p v-if="markPlan" class="mark-context">
        <strong>{{ markPlanName }}</strong> · {{ formatMoney(markPlan.amount) }}
        <span class="mark-context__freq">pro {{ frequencyLabel(markPlan.frequency) }}</span>
      </p>
      <Message v-if="markError" severity="error" variant="simple" class="mark-error">
        {{ markError }}
      </Message>
      <FormFieldRow label="Betrag" html-for="mark-amount">
        <MoneyInput
          id="mark-amount"
          v-model="markForm.amount"
          :currency="currencyCode"
          :min="0"
        />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="mark-date">
        <DatePicker
          id="mark-date"
          v-model="markForm.date"
          showIcon
          dateFormat="dd.mm.yy"
        />
        <small class="form-field-helper">{{ todayDateHelperText }}</small>
      </FormFieldRow>
      <FormFieldRow label="Notiz (optional)" html-for="mark-note" wide>
        <InputText
          id="mark-note"
          v-model="markForm.description"
          placeholder="z. B. Miete + Nebenkosten"
          maxlength="500"
        />
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

/* Issue #59: warn/danger-Severity fuer den Coverage-Tag (analog zu
   savings-progress.ts, damit der User dieselbe Farb-Sprache
   wiedererkennt). */
.row-tag--warn {
  background: rgba(251, 191, 36, 0.18);
  color: #fbbf24;
}

.row-tag--danger {
  background: rgba(248, 113, 113, 0.18);
  color: #f87171;
}

.row-tag__hint {
  margin-left: 4px;
  opacity: 0.75;
  font-size: 0.65rem;
  font-weight: 500;
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

/* Issue #59: Toggle-Button am Listenende, um Non-Due-Plaene ein-/
   auszublenden. Bewusst unaufdringlich gestaltet (kein gefuellter
   Button), weil das nicht der primaere Use-Case ist. */
.recurring-showall {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 0.75rem;
  padding: 6px 12px;
  background: transparent;
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.82rem;
  font-weight: 500;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.recurring-showall:hover {
  background: rgba(148, 163, 184, 0.06);
  border-color: rgba(96, 165, 250, 0.42);
  color: var(--color-text-primary, #f1f5f9);
}

.recurring-showall__icon {
  font-size: 0.85rem;
}

/* Issue #59: Kontext-Text oben im Mark-Dialog, plus Error-Spacing. */
.mark-context {
  margin: 0 0 0.4rem;
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.86rem;
}

.mark-context__freq {
  margin-left: 4px;
  font-size: 0.78rem;
  opacity: 0.85;
}

.mark-error {
  margin-bottom: 0.6rem;
}
</style>