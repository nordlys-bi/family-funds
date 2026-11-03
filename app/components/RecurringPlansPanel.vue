<!--
  RecurringPlansPanel — wiederkehrende Plaene einer Art (ADR-0005): anlegen,
  bearbeiten, loeschen und direkt daraus die Buchung erzeugen.

  Die Seite "Wiederkehrend" ist darin aufgegangen: Fixkosten-Plaene liegen bei
  den Fixkosten-Umschlaegen, deren Zuteilung sie bestimmen; Einnahmen-Plaene bei
  den Einnahmen. Beide Arten haben denselben Ablauf, deshalb eine Komponente.

  Plaene anlegen, aendern und loeschen ist Owner-only (issue #128), "als bezahlt
  bzw. erhalten markieren" ist eine normale Buchung und bleibt fuer alle da.
  Nach jeder Aenderung kommt `changed`: Zuteilung und Salden koennen sich
  geaendert haben, die Seite laedt ihre Daten neu.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Frequency } from '~/types/planning'
import { todayDateHelperText } from '~/utils/form-helpers'

type PlanCoverage = { due: number; paid: number; percent: number }

type PlanItem = {
  id: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  envelopeId: string | null
  coverage: PlanCoverage
  nextDueDate: string | null
}

const props = defineProps<{
  kind: 'fixedCost' | 'income'
}>()

const emit = defineEmits<{
  changed: []
}>()

const { activeHousehold, canManageHousehold } = useHousehold()
// Swipe (rechts = bearbeiten, links = loeschen) nur mobil und nur fuer Owner (issue #132).
const { swipeDisabled } = useListSwipe()
const confirm = useAskConfirm()
const { envelopes, load: loadEnvelopes } = useEnvelopeOptions()

const isFixedCost = computed(() => props.kind === 'fixedCost')
const copy = computed(() => (isFixedCost.value
  ? { title: 'Fixkosten-Pläne', plan: 'Fixkostenplan', namePlaceholder: 'z. B. Miete', empty: 'Noch keine Fixkostenpläne angelegt.', markLabel: 'Bezahlt markieren', markHeader: 'Fixkosten als bezahlt markieren', markedVerb: 'bezahlt markiert', planningKind: 'fixedCostPlan' as const, path: 'fixed-cost-plans', sign: '−' }
  : { title: 'Einnahmen-Pläne', plan: 'Einnahmenplan', namePlaceholder: 'z. B. Gehalt', empty: 'Noch keine Einnahmenpläne angelegt.', markLabel: 'Erhalten markieren', markHeader: 'Einnahme als erhalten markieren', markedVerb: 'erhalten markiert', planningKind: 'incomePlan' as const, path: 'income-plans', sign: '+' }))

const plans = ref<PlanItem[]>([])
const notice = ref<{ severity: 'success' | 'error'; text: string } | null>(null)
const householdId = computed(() => activeHousehold.value?.id ?? null)
const currency = computed(() => activeHousehold.value?.currency ?? 'EUR')
const formatMoney = (value: number) => formatMoneyFromCents(value, currency.value)
const monthlyEquivalent = (amount: number, frequency: Frequency) => Math.round(amount * monthlyFrequencyFactor(frequency))
const envelopeName = (id: string | null) => envelopes.value.find((envelope) => envelope.id === id)?.name ?? 'Zu verteilen'

async function load() {
  if (!householdId.value) return
  try {
    const data = await $fetch<{ household: { fixedCosts: PlanItem[]; incomePlans: PlanItem[] } | null }>('/api/households/current')
    plans.value = (isFixedCost.value ? data.household?.fixedCosts : data.household?.incomePlans) ?? []
    await loadEnvelopes(householdId.value)
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Pläne konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  }
}

onMounted(load)
watch(householdId, load)

async function afterChange(text: string | (() => string)) {
  await load()
  notice.value = { severity: 'success', text: typeof text === 'function' ? text() : text }
  emit('changed')
}

// Plaene ohne Faelligkeit in diesem Monat sind per Default ausgeblendet.
const showAll = ref(false)
const isNonDue = (plan: PlanItem) => plan.coverage.due === 0
const visiblePlans = computed(() => (showAll.value ? plans.value : plans.value.filter((plan) => !isNonDue(plan))))
const nonDueCount = computed(() => plans.value.filter(isNonDue).length)

function severityForPercent(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 100) return 'success'
  if (percent >= 50) return 'warning'
  return 'danger'
}

// === Anlegen / Bearbeiten ==============================================
const planDialogOpen = ref(false)
const planSaving = ref(false)
const planEditId = ref<string | null>(null)
const blankForm = () => ({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  startDate: new Date() as Date | null,
  endDate: null as Date | null,
  envelopeId: null as string | null,
})
const planForm = ref(blankForm())

// Die Umschlag-Auswahl frisch laden: Auf derselben Seite kann gerade einer
// angelegt worden sein, den das Panel beim Mounten noch nicht kannte.
function openCreate() {
  loadEnvelopes(householdId.value)
  planEditId.value = null
  planForm.value = blankForm()
  planDialogOpen.value = true
}

function openEdit(plan: PlanItem) {
  loadEnvelopes(householdId.value)
  planEditId.value = plan.id
  planForm.value = {
    name: plan.name,
    amount: plan.amount / 100,
    frequency: plan.frequency,
    startDate: new Date(plan.startDate),
    endDate: parseDateInputString(plan.endDate),
    envelopeId: plan.envelopeId,
  }
  planDialogOpen.value = true
}

async function savePlan() {
  if (!householdId.value) return
  planSaving.value = true
  notice.value = null
  try {
    const isEdit = Boolean(planEditId.value)
    const previousEnvelopeId = plans.value.find((plan) => plan.id === planEditId.value)?.envelopeId ?? null
    await $fetch(`/api/households/${householdId.value}/planning`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: {
        kind: copy.value.planningKind,
        ...(isEdit ? { id: planEditId.value } : {}),
        name: planForm.value.name,
        amount: planForm.value.amount,
        frequency: planForm.value.frequency,
        startDate: planForm.value.startDate ? formatDateToInputString(planForm.value.startDate) : undefined,
        endDate: planForm.value.endDate ? formatDateToInputString(planForm.value.endDate) : null,
        envelopeId: planForm.value.envelopeId,
      },
    })
    planDialogOpen.value = false
    const addedTo = !isEdit || previousEnvelopeId !== planForm.value.envelopeId ? planForm.value.envelopeId : null
    const form = planForm.value
    await afterChange(() => `${copy.value.plan} ${isEdit ? 'aktualisiert' : 'angelegt'}.${alreadyAllocatedHint(addedTo, form.frequency, form.startDate, form.endDate)}`)
  } catch (error: any) {
    notice.value = { severity: 'error', text: `${copy.value.plan} konnte nicht gespeichert werden: ` + (error.statusMessage || error.message) }
  } finally {
    planSaving.value = false
  }
}

// ADR-0005, Regel 1: Eine begonnene Periode ist gebucht, ein neuer Plan aendert
// sie nicht. Ohne Hinweis stuende der Umschlag bei der ersten Zahlung im Minus,
// ein einmaliger Plan bekaeme gar nichts. Laeuft nach dem Neuladen: Das Speichern
// bucht die Periode, und `currentPeriod` stammt aus der frischen Uebersicht.
function alreadyAllocatedHint(envelopeId: string | null, frequency: Frequency, startDate: Date | null, endDate: Date | null) {
  const envelope = envelopes.value.find((item) => item.id === envelopeId)
  const period = envelope?.currentPeriod
  if (!isFixedCost.value || !period || envelope?.allocationSource !== 'PLANS' || !startDate) return ''
  const start = new Date(period.start)
  const end = new Date(period.end)
  const once = frequency === 'ONCE'
  if (startDate >= end || (endDate && endDate < start) || (once && startDate < start)) return ''
  return once
    ? ' Diese Periode ist schon zugeteilt: Der einmalige Betrag bekommt sonst kein Geld, bitte die Zuteilung im Umschlag erhöhen.'
    : ' Diese Periode ist schon zugeteilt: Das Geld fließt ab der nächsten Periode, für diese bitte die Zuteilung im Umschlag erhöhen.'
}

const deletingId = ref<string | null>(null)

async function removePlan(plan: PlanItem) {
  if (!householdId.value) return
  // ConfirmSheet (issue #51): Plaene haben kein Undo.
  const ok = await confirm.ask({
    title: `${copy.value.plan} löschen?`,
    message: `„${plan.name}" wird endgültig entfernt. Vergangene Buchungen und Zuteilungen bleiben unberührt.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return
  deletingId.value = plan.id
  notice.value = null
  try {
    await $fetch(`/api/households/${householdId.value}/${copy.value.path}/${plan.id}`, { method: 'DELETE' })
    await afterChange('Plan wurde gelöscht.')
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Plan konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    deletingId.value = null
  }
}

// === Buchung aus dem Plan (issue #59) ==================================
// Der Umschlag kommt vom Plan: Der Server erbt ihn, sobald der Plan-FK gesetzt
// ist. Abweichungen gehen nachtraeglich im Inline-Editor der Buchungsliste.
const markPlan = ref<PlanItem | null>(null)
const markSaving = ref(false)
const markError = ref<string | null>(null)
const markForm = ref({ amount: null as number | null, date: new Date() as Date | null, description: '' })
const markDialogOpen = computed({
  get: () => markPlan.value !== null,
  set: (open) => { if (!open) markPlan.value = null },
})

function openMark(plan: PlanItem) {
  markPlan.value = plan
  // Notiz mit dem Plannamen vorbelegen, damit die Buchung wiedererkennbar ist.
  markForm.value = { amount: plan.amount / 100, date: new Date(), description: plan.name }
  markError.value = null
}

async function submitMark() {
  const plan = markPlan.value
  if (!householdId.value || !plan) return
  if (!markForm.value.amount || markForm.value.amount <= 0) {
    markError.value = 'Betrag muss größer als 0 sein.'
    return
  }
  markSaving.value = true
  markError.value = null
  try {
    await $fetch(`/api/households/${householdId.value}/transactions`, {
      method: 'POST',
      body: {
        kind: isFixedCost.value ? 'expense' : 'income',
        amount: markForm.value.amount,
        date: formatDateToInputString(markForm.value.date ?? new Date()),
        description: markForm.value.description.trim() || null,
        ...(isFixedCost.value ? { fixedCostPlanId: plan.id } : { incomePlanId: plan.id }),
      },
    })
    markPlan.value = null
    await afterChange(`${plan.name} wurde als ${copy.value.markedVerb}.`)
  } catch (error: any) {
    markError.value = error?.statusMessage || error?.message || 'Speichern fehlgeschlagen.'
  } finally {
    markSaving.value = false
  }
}
</script>

<template>
  <ListPanel
    :title="copy.title"
    compact
    :badge="`${visiblePlans.length} fällig${nonDueCount > 0 && !showAll ? ` · ${nonDueCount} diesen Monat nicht fällig` : ''}`"
  >
    <template v-if="canManageHousehold" #actions>
      <Button :label="copy.plan" icon="pi pi-plus" size="small" severity="secondary" outlined @click="openCreate" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <SwipeableListItem
      v-for="plan in visiblePlans"
      :key="plan.id"
      :disabled="swipeDisabled"
      swipe-right-icon="pi pi-pen-to-square"
      swipe-right-label="Bearbeiten"
      swipe-left-icon="pi pi-trash"
      swipe-left-label="Löschen"
      @swipe-right="openEdit(plan)"
      @swipe-left="removePlan(plan)"
    >
      <ItemCard :hover-actions="false">
        <template #main>
          <span class="row-title">
            {{ plan.name }}
            <span class="row-tag" :class="isFixedCost ? 'row-tag--warning' : 'row-tag--green'">{{ copy.sign }} {{ formatMoney(monthlyEquivalent(plan.amount, plan.frequency)) }} / Mo</span>
          </span>
          <span class="row-sub">
            <span class="row-tag">{{ frequencyLabel(plan.frequency) }}</span>
            <span>{{ envelopeName(plan.envelopeId) }}</span>
            <span v-if="plan.nextDueDate">fällig {{ formatPlanningDate(plan.nextDueDate) }}</span>
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
            </span>
          </span>
        </template>
        <template #aside>
          <div>
            {{ formatMoney(plan.amount) }}
            <span class="amount-secondary">pro {{ frequencyLabel(plan.frequency) }}</span>
          </div>
        </template>
        <!-- Nur wenn der Plan in diesem Monat offen ist (issue #59). Der Slot
             haengt an der Bedingung, damit mobil keine leere Zeile bleibt (#132). -->
        <template v-if="plan.coverage.due > 0 && plan.coverage.percent < 100" #actions>
          <Button
            icon="pi pi-check-circle"
            :severity="isFixedCost ? 'primary' : 'success'"
            text
            size="small"
            :aria-label="`${plan.name}: ${copy.markLabel}`"
            @click="openMark(plan)"
          />
        </template>
        <!-- Bearbeiten/Loeschen nur ab 640px als Buttons; mobil per Swipe (#132). -->
        <template v-if="canManageHousehold" #actions-desktop>
          <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text :aria-label="`${plan.name} bearbeiten`" @click="openEdit(plan)" />
          <Button icon="pi pi-trash" severity="danger" outlined size="small" text :aria-label="`${plan.name} löschen`" :loading="deletingId === plan.id" @click="removePlan(plan)" />
        </template>
      </ItemCard>
    </SwipeableListItem>

    <div v-if="plans.length === 0" class="empty-list">{{ copy.empty }}</div>

    <button v-if="nonDueCount > 0" type="button" class="recurring-showall" @click="showAll = !showAll">
      <i :class="['pi', showAll ? 'pi-eye-slash' : 'pi-eye', 'recurring-showall__icon']" aria-hidden="true" />
      {{ showAll ? 'Nur fällige Pläne anzeigen' : `${nonDueCount} diesen Monat nicht fällige Pläne anzeigen` }}
    </button>

    <FormDialog
      v-model:visible="planDialogOpen"
      :header="`${copy.plan} ${planEditId ? 'bearbeiten' : 'anlegen'}`"
      :submit-label="`${copy.plan} ${planEditId ? 'aktualisieren' : 'anlegen'}`"
      :saving="planSaving"
      @save="savePlan"
      @cancel="planDialogOpen = false"
    >
      <RecurringPlanForm
        v-model="planForm"
        :id-prefix="kind"
        :currency="currency"
        :envelopes="envelopes"
        :name-placeholder="copy.namePlaceholder"
      />
    </FormDialog>

    <FormDialog
      v-model:visible="markDialogOpen"
      :header="copy.markHeader"
      :submit-label="copy.markLabel"
      :submit-severity="isFixedCost ? 'primary' : 'success'"
      :saving="markSaving"
      width="min(38rem, 94vw)"
      @save="submitMark"
      @cancel="markPlan = null"
    >
      <p v-if="markPlan" class="mark-context">
        <strong>{{ markPlan.name }}</strong> · {{ formatMoney(markPlan.amount) }}
        <span class="mark-context__freq">pro {{ frequencyLabel(markPlan.frequency) }}</span>
      </p>
      <Message v-if="markError" severity="error" variant="simple" class="mark-error">{{ markError }}</Message>
      <FormFieldRow label="Betrag" html-for="mark-amount">
        <MoneyInput id="mark-amount" v-model="markForm.amount" :currency="currency" :min="0" />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="mark-date">
        <DatePicker id="mark-date" v-model="markForm.date" showIcon dateFormat="dd.mm.yy" />
        <small class="form-field-helper">{{ todayDateHelperText }}</small>
      </FormFieldRow>
      <FormFieldRow label="Notiz (optional)" html-for="mark-note" wide>
        <InputText id="mark-note" v-model="markForm.description" placeholder="z. B. Miete + Nebenkosten" maxlength="500" />
      </FormFieldRow>
    </FormDialog>
  </ListPanel>
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
  color: var(--color-accent-primary-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.row-tag--green {
  background: rgba(52, 211, 153, 0.16);
  color: var(--color-accent-success-text);
}

.row-tag--warning {
  background: rgba(251, 191, 36, 0.16);
  color: var(--color-accent-warning-text);
}

/* Issue #59: warn/danger-Severity fuer den Coverage-Tag (dieselbe
   Farb-Sprache wie bei den Umschlaegen). */
.row-tag--warn {
  background: rgba(251, 191, 36, 0.18);
  color: var(--color-accent-warning-text);
}

.row-tag--danger {
  background: rgba(248, 113, 113, 0.18);
  color: var(--color-accent-danger-text);
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
  border: 1px dashed var(--color-border-default);
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
  border: 1px dashed var(--color-border-default);
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
