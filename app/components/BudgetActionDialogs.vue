<!--
  BudgetActionDialogs — Anlegen/Bearbeiten, Schließen, Umbuchen und Löschen
  eines Budgets (ADR-0004). Ausgelagert aus der frueheren Budget-Seite,
  weil Liste (Anlegen, Swipe-Bearbeiten/-Loeschen, #140) und Detailseite
  (alle Aktionen) dieselben Dialoge brauchen.

  Die Seite oeffnet die Dialoge ueber die exponierten Methoden und laedt
  nach `changed` neu; Erfolgs- und Fehlermeldungen ausserhalb der Dialoge
  kommen als `notice`. Owner-only (#128) entscheidet die Seite — hier wird
  nur ausgefuehrt, der Server prueft ohnehin.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Frequency, Notice } from '~/types/planning'
import type { BudgetListItem } from '~/types/budget'

const props = defineProps<{
  householdId: string
  /** Alle Budgets des Haushalts (auch geschlossene) — fuer Ziel-Auswahl und Namen. */
  budgets: BudgetListItem[]
  savingsGoals: Array<{ id: string; name: string }>
  currency: string
}>()

const emit = defineEmits<{
  /** Daten haben sich geaendert, Seite soll neu laden. */
  changed: []
  notice: [notice: Notice]
  /** Budget wurde geloescht (Detailseite navigiert dann zur Liste). */
  deleted: [budgetId: string]
}>()

const confirm = useAskConfirm()
const formatMoney = (value: number) => formatMoneyFromCents(value, props.currency)
const balanceOf = (budget: BudgetListItem | null) => budget?.balance?.balance ?? 0
const budgetsById = computed(() => new Map(props.budgets.map((budget) => [budget.id, budget] as const)))

// === Anlegen / Bearbeiten =============================================
const budgetDialogOpen = ref(false)
const budgetSaving = ref(false)
const budgetEditId = ref<string | null>(null)
const budgetForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
})

function openCreate() {
  budgetEditId.value = null
  budgetForm.value = {
    name: '',
    amount: null,
    frequency: 'MONTHLY',
    validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
  }
  budgetDialogOpen.value = true
}

function openEdit(budget: BudgetListItem) {
  budgetEditId.value = budget.id
  const latestVersion = budget.versions[0]
  budgetForm.value = {
    name: budget.name,
    amount: latestVersion ? latestVersion.amount / 100 : null,
    frequency: budget.frequency,
    validFrom: latestVersion ? new Date(latestVersion.validFrom) : new Date(),
  }
  budgetDialogOpen.value = true
}

watch(
  () => budgetForm.value.frequency,
  (frequency) => {
    if (!budgetEditId.value) {
      budgetForm.value.validFrom = getPeriodStartDate(new Date(), frequency)
    }
  },
)

async function saveBudget() {
  budgetSaving.value = true
  try {
    const isEdit = Boolean(budgetEditId.value)
    await $fetch(`/api/households/${props.householdId}/planning`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: {
        kind: 'budget',
        ...(budgetEditId.value ? { id: budgetEditId.value } : {}),
        name: budgetForm.value.name,
        amount: budgetForm.value.amount,
        // ADR-0004: Frequenz nur beim Anlegen — danach unveraenderlich.
        ...(budgetEditId.value ? {} : { frequency: budgetForm.value.frequency }),
        validFrom: formatDateToInputString(budgetForm.value.validFrom),
      },
    })
    budgetDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: isEdit ? 'Budget wurde aktualisiert.' : 'Budget wurde angelegt.' })
  } catch (error: any) {
    emit('notice', { severity: 'error', text: 'Budget konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) })
  } finally {
    budgetSaving.value = false
  }
}

// === Löschen ==========================================================
const deletingId = ref<string | null>(null)

async function remove(budget: BudgetListItem) {
  // ConfirmSheet (issue #51): kein Undo fuer Budgets, also ist der Sheet
  // die einzige Sicherung gegen Fehlklicks.
  const ok = await confirm.ask({
    title: 'Budget löschen?',
    message: `„${budget.name}" wird endgültig entfernt. Das geht nur, solange noch nichts darauf gebucht wurde — sonst das Budget stattdessen schließen.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  deletingId.value = budget.id
  try {
    await $fetch(`/api/households/${props.householdId}/budgets/${budget.id}`, { method: 'DELETE' })
    emit('deleted', budget.id)
    emit('changed')
    emit('notice', { severity: 'success', text: `„${budget.name}" wurde gelöscht.` })
  } catch (error: any) {
    // ADR-0004: 409 = Budget hat Buchungen, Umbuchungen oder Vorgaenger.
    emit('notice', error.statusCode === 409
      ? { severity: 'warn', text: `„${budget.name}" hat bereits Buchungen und kann nicht gelöscht werden. Schließe es stattdessen in ein anderes Budget.` }
      : { severity: 'error', text: 'Budget konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) })
  } finally {
    deletingId.value = null
  }
}

// === Schließen ========================================================
// Stichtag (Periodenbeginn) + Pflicht-Ziel. Default ist der naechste
// Periodenbeginn, damit die laufende Periode noch genutzt wird.
const closeDialogOpen = ref(false)
const closeSaving = ref(false)
const closeError = ref<string | null>(null)
const closeForm = ref({
  budgetId: '',
  closedAt: new Date() as Date | null,
  targetId: null as string | null,
})
const closingBudget = computed(() => budgetsById.value.get(closeForm.value.budgetId) ?? null)
const closeDialogHeader = computed(() => `„${closingBudget.value?.name ?? ''}“ schließen`)
// Ziel: anderes Budget, das am Stichtag noch offen ist (sonst Zyklus).
const closeTargetOptions = computed(() =>
  budgetsOpenOn(
    props.budgets.filter((budget) => budget.id !== closeForm.value.budgetId),
    closeForm.value.closedAt,
  ).map((budget) => ({ label: budget.name, value: budget.id })),
)

function openClose(budget: BudgetListItem) {
  closeForm.value = {
    budgetId: budget.id,
    closedAt: getNextPeriodStartDate(new Date(), budget.frequency),
    targetId: null,
  }
  closeError.value = null
  closeDialogOpen.value = true
}

async function saveClose() {
  if (!closingBudget.value) return
  if (!closeForm.value.closedAt) {
    closeError.value = 'Bitte einen Stichtag wählen.'
    return
  }
  if (!closeForm.value.targetId) {
    closeError.value = 'Bitte ein Ziel-Budget wählen — der Saldo darf nicht verschwinden.'
    return
  }
  closeSaving.value = true
  closeError.value = null
  try {
    await $fetch(`/api/households/${props.householdId}/budgets/${closingBudget.value.id}/close`, {
      method: 'POST',
      body: {
        closedAt: formatDateToInputString(closeForm.value.closedAt),
        carryoverToBudgetId: closeForm.value.targetId,
      },
    })
    closeDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: `„${closingBudget.value?.name ?? 'Budget'}" wurde geschlossen.` })
  } catch (error: any) {
    closeError.value = error.statusCode === 409
      ? 'Es gibt Buchungen ab dem Stichtag. Bitte zuerst auf ein anderes Budget umhängen oder einen späteren Stichtag wählen.'
      : 'Budget konnte nicht geschlossen werden: ' + (error.statusMessage || error.message)
  } finally {
    closeSaving.value = false
  }
}

// === Umbuchen Budget <-> Spartopf =====================================
// Eine SavingsGoalExecution mit sourceBudgetId. Richtung als Auswahl statt
// Vorzeichen-Eingabe.
const transferDialogOpen = ref(false)
const transferSaving = ref(false)
const transferError = ref<string | null>(null)
const transferForm = ref({
  budgetId: '',
  goalId: null as string | null,
  direction: 'toGoal' as 'toGoal' | 'toBudget',
  amount: null as number | null,
  date: new Date() as Date | null,
  note: '',
})
const transferBudget = computed(() => budgetsById.value.get(transferForm.value.budgetId) ?? null)
const transferDialogHeader = computed(() => `Umbuchen: ${transferBudget.value?.name ?? ''}`)
const transferNotePlaceholder = computed(() => `Umbuchung ${transferBudget.value?.name ?? ''}`)
const savingsGoalOptions = computed(() => props.savingsGoals.map((goal) => ({ label: goal.name, value: goal.id })))
const transferDirectionOptions = [
  { label: 'Vom Budget in den Spartopf', value: 'toGoal' },
  { label: 'Aus dem Spartopf ins Budget', value: 'toBudget' },
]
// Kein Saldo-Limit (ADR-0004), nur ein Hinweis, wenn der Saldo dadurch
// negativ wird.
const transferOverdraws = computed(() =>
  transferForm.value.direction === 'toGoal'
  && transferBudget.value !== null
  && transferForm.value.amount !== null
  && Math.round(transferForm.value.amount * 100) > balanceOf(transferBudget.value),
)

function openTransfer(budget: BudgetListItem) {
  const balance = balanceOf(budget)
  transferForm.value = {
    budgetId: budget.id,
    goalId: savingsGoalOptions.value[0]?.value ?? null,
    direction: 'toGoal',
    amount: balance > 0 ? balance / 100 : null,
    date: new Date(),
    note: '',
  }
  transferError.value = null
  transferDialogOpen.value = true
}

async function saveTransfer() {
  if (!transferBudget.value) return
  if (!transferForm.value.goalId) {
    transferError.value = 'Bitte einen Spartopf wählen.'
    return
  }
  if (transferForm.value.amount == null || transferForm.value.amount <= 0) {
    transferError.value = 'Betrag muss größer als 0 sein.'
    return
  }
  if (!transferForm.value.date) {
    transferError.value = 'Bitte ein Datum wählen.'
    return
  }
  if (!isBudgetOpenOn(transferBudget.value, transferForm.value.date)) {
    transferError.value = 'Das Budget ist zu diesem Datum bereits geschlossen.'
    return
  }
  transferSaving.value = true
  transferError.value = null
  try {
    const signed = transferForm.value.direction === 'toGoal' ? transferForm.value.amount : -transferForm.value.amount
    await $fetch(`/api/households/${props.householdId}/savings-goals/${transferForm.value.goalId}/executions`, {
      method: 'POST',
      body: {
        amount: signed,
        date: formatDateToInputString(transferForm.value.date),
        note: transferForm.value.note || `Umbuchung ${transferBudget.value.name}`,
        sourceBudgetId: transferBudget.value.id,
      },
    })
    transferDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: 'Umbuchung wurde gespeichert.' })
  } catch (error: any) {
    transferError.value = 'Umbuchung fehlgeschlagen: ' + (error.statusMessage || error.message)
  } finally {
    transferSaving.value = false
  }
}

defineExpose({ openCreate, openEdit, openClose, openTransfer, remove, deletingId })
</script>

<template>
  <FormDialog
    v-model:visible="budgetDialogOpen"
    :header="budgetEditId ? 'Budget bearbeiten' : 'Budget anlegen'"
    :submit-label="budgetEditId ? 'Budget aktualisieren' : 'Budget anlegen'"
    :saving="budgetSaving"
    @save="saveBudget"
    @cancel="budgetDialogOpen = false"
  >
    <BudgetForm v-model="budgetForm" :currency="currency" :frequency-locked="Boolean(budgetEditId)" />
  </FormDialog>

  <!-- ADR-0004: Budget schließen — Saldo fließt per Verweis ins Ziel. -->
  <FormDialog
    v-model:visible="closeDialogOpen"
    :header="closeDialogHeader"
    submit-label="Budget schließen"
    submit-severity="danger"
    :saving="closeSaving"
    @save="saveClose"
    @cancel="closeDialogOpen = false"
  >
    <p class="dialog-hint">
      Ab dem Stichtag bekommt das Budget keine Zuteilungen mehr und nimmt keine Buchungen mehr an.
      Sein Saldo ({{ formatMoney(balanceOf(closingBudget)) }}) fließt ins Ziel-Budget — auch spätere Korrekturen von Buchungen vor dem Stichtag.
      Für einen Wechsel der Frequenz zuerst das neue Budget anlegen, dann das alte hinein schließen.
    </p>
    <FormFieldRow label="Stichtag" html-for="close-date">
      <DatePicker id="close-date" v-model="closeForm.closedAt" show-icon date-format="dd.mm.yy" />
    </FormFieldRow>
    <FormFieldRow label="Ziel-Budget" html-for="close-target" wide>
      <Select
        id="close-target"
        v-model="closeForm.targetId"
        :options="closeTargetOptions"
        option-label="label"
        option-value="value"
        placeholder="Budget wählen"
        empty-message="Kein offenes Budget — zuerst ein neues anlegen"
      />
    </FormFieldRow>
    <Message v-if="closeError" severity="error" variant="simple">{{ closeError }}</Message>
  </FormDialog>

  <!-- ADR-0004: Umbuchung Budget <-> Spartopf (eine Execution mit sourceBudgetId). -->
  <FormDialog
    v-model:visible="transferDialogOpen"
    :header="transferDialogHeader"
    submit-label="Umbuchen"
    :saving="transferSaving"
    @save="saveTransfer"
    @cancel="transferDialogOpen = false"
  >
    <p class="dialog-hint">Aktueller Saldo: {{ formatMoney(balanceOf(transferBudget)) }}</p>
    <FormFieldRow label="Richtung" html-for="transfer-direction" wide>
      <Select
        id="transfer-direction"
        v-model="transferForm.direction"
        :options="transferDirectionOptions"
        option-label="label"
        option-value="value"
      />
    </FormFieldRow>
    <FormFieldRow label="Spartopf" html-for="transfer-goal" wide>
      <Select
        id="transfer-goal"
        v-model="transferForm.goalId"
        :options="savingsGoalOptions"
        option-label="label"
        option-value="value"
        placeholder="Spartopf wählen"
      />
    </FormFieldRow>
    <FormFieldRow label="Betrag" html-for="transfer-amount">
      <MoneyInput id="transfer-amount" v-model="transferForm.amount" :currency="currency" />
    </FormFieldRow>
    <FormFieldRow label="Datum" html-for="transfer-date" subtle>
      <DatePicker id="transfer-date" v-model="transferForm.date" show-icon date-format="dd.mm.yy" />
    </FormFieldRow>
    <FormFieldRow label="Notiz" html-for="transfer-note" wide>
      <InputText id="transfer-note" v-model="transferForm.note" :placeholder="transferNotePlaceholder" />
    </FormFieldRow>
    <Message v-if="transferOverdraws" severity="warn" variant="simple">
      Der Saldo des Budgets wird dadurch negativ.
    </Message>
    <Message v-if="transferError" severity="error" variant="simple">{{ transferError }}</Message>
  </FormDialog>
</template>

<style scoped>
.dialog-hint {
  margin: 0 0 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
</style>
