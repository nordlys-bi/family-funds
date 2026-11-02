<!--
  BudgetActionDialogs — Anlegen/Bearbeiten, Schließen, Umbuchen und Löschen
  eines Umschlags (ADR-0005). Neu angelegte landen vorerst in der Gruppe
  "Laufende Ausgaben"; die Wahl der Gruppe kommt mit #158. Ausgelagert aus der frueheren Budget-Seite,
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
import type { EnvelopeItem } from '~/types/envelope'

const props = defineProps<{
  householdId: string
  /** Alle Umschlaege des Haushalts (auch geschlossene) — fuer Ziel-Auswahl und Namen. */
  budgets: EnvelopeItem[]
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
const balanceOf = (budget: EnvelopeItem | null) => budget?.balance.balance ?? 0
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

function openEdit(budget: EnvelopeItem) {
  budgetEditId.value = budget.id
  budgetForm.value = {
    name: budget.name,
    amount: budget.allocationAmount === null ? null : budget.allocationAmount / 100,
    frequency: budget.frequency,
    validFrom: new Date(budget.balanceSince),
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
    // Ein neuer Betrag wirkt ab der naechsten noch nicht gebuchten Periode
    // (ADR-0005); Frequenz und Start sind nach dem Anlegen fest.
    if (budgetEditId.value) {
      await $fetch(`/api/households/${props.householdId}/envelopes/${budgetEditId.value}`, {
        method: 'PATCH',
        body: { name: budgetForm.value.name, allocationAmount: budgetForm.value.amount },
      })
    } else {
      await $fetch(`/api/households/${props.householdId}/envelopes`, {
        method: 'POST',
        body: {
          name: budgetForm.value.name,
          group: 'RUNNING',
          frequency: budgetForm.value.frequency,
          allocationAmount: budgetForm.value.amount,
          balanceSince: formatDateToInputString(budgetForm.value.validFrom),
        },
      })
    }
    budgetDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: isEdit ? 'Umschlag wurde aktualisiert.' : 'Umschlag wurde angelegt.' })
  } catch (error: any) {
    emit('notice', { severity: 'error', text: 'Umschlag konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) })
  } finally {
    budgetSaving.value = false
  }
}

// === Löschen ==========================================================
const deletingId = ref<string | null>(null)

async function remove(budget: EnvelopeItem) {
  // ConfirmSheet (issue #51): kein Undo fuer Budgets, also ist der Sheet
  // die einzige Sicherung gegen Fehlklicks.
  const ok = await confirm.ask({
    title: 'Umschlag löschen?',
    message: `„${budget.name}" wird endgültig entfernt. Das geht nur, solange noch nichts darauf gebucht wurde — sonst den Umschlag stattdessen schließen.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  deletingId.value = budget.id
  try {
    await $fetch(`/api/households/${props.householdId}/envelopes/${budget.id}`, { method: 'DELETE' })
    emit('deleted', budget.id)
    emit('changed')
    emit('notice', { severity: 'success', text: `„${budget.name}" wurde gelöscht.` })
  } catch (error: any) {
    // ADR-0004: 409 = Budget hat Buchungen, Umbuchungen oder Vorgaenger.
    emit('notice', error.statusCode === 409
      ? { severity: 'warn', text: `„${budget.name}" hat bereits Buchungen und kann nicht gelöscht werden. Schließe ihn stattdessen.` }
      : { severity: 'error', text: 'Umschlag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) })
  } finally {
    deletingId.value = null
  }
}

// === Schließen ========================================================
// Stichtag (Periodenbeginn) + Pflicht-Ziel, auch "Zu verteilen" (ADR-0005).
// Default ist der naechste
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
// Ziel: "Zu verteilen" oder ein anderer Umschlag, der am Stichtag noch offen
// ist (sonst Zyklus). Eigener Wert statt '', weil das Ziel bewusst gewaehlt
// sein muss und '' im Select wie "nichts gewaehlt" aussaehe.
const UNASSIGNED_TARGET = 'unassigned'
const closeTargetOptions = computed(() => [
  { label: 'Zu verteilen', value: UNASSIGNED_TARGET },
  ...props.budgets
    .filter((budget) => budget.id !== closeForm.value.budgetId && (!budget.closedAt || (closeForm.value.closedAt && isBudgetOpenOn(budget, closeForm.value.closedAt))))
    .map((budget) => ({ label: budget.name, value: budget.id })),
])

function openClose(budget: EnvelopeItem) {
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
    closeError.value = 'Bitte ein Ziel wählen — der Saldo darf nicht verschwinden.'
    return
  }
  closeSaving.value = true
  closeError.value = null
  try {
    await $fetch(`/api/households/${props.householdId}/envelopes/${closingBudget.value.id}/close`, {
      method: 'POST',
      body: {
        closedAt: formatDateToInputString(closeForm.value.closedAt),
        carryoverToEnvelopeId: closeForm.value.targetId === UNASSIGNED_TARGET ? null : closeForm.value.targetId,
      },
    })
    closeDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: `„${closingBudget.value?.name ?? 'Umschlag'}" wurde geschlossen.` })
  } catch (error: any) {
    closeError.value = error.statusCode === 409
      ? 'Es gibt Buchungen ab dem Stichtag. Bitte zuerst auf einen anderen Umschlag umhängen oder einen späteren Stichtag wählen.'
      : 'Umschlag konnte nicht geschlossen werden: ' + (error.statusMessage || error.message)
  } finally {
    closeSaving.value = false
  }
}

// === Umbuchen ==========================================================
// Geld zwischen diesem Umschlag und einem anderen oder "Zu verteilen"
// (ADR-0005). Richtung als Auswahl; die Gegenseite ist '' fuer "Zu verteilen".
const transferDialogOpen = ref(false)
const transferSaving = ref(false)
const transferError = ref<string | null>(null)
const transferForm = ref({
  budgetId: '',
  counterpartId: '',
  direction: 'out' as 'out' | 'in',
  amount: null as number | null,
  date: new Date() as Date | null,
  note: '',
})
const transferBudget = computed(() => budgetsById.value.get(transferForm.value.budgetId) ?? null)
const transferDialogHeader = computed(() => `Umbuchen: ${transferBudget.value?.name ?? ''}`)
const transferNotePlaceholder = computed(() => `Umbuchung ${transferBudget.value?.name ?? ''}`)
const transferCounterpartOptions = computed(() => [
  { label: 'Zu verteilen', value: '' },
  ...sortEnvelopes(envelopesBookableOn(props.budgets, transferForm.value.date))
    .filter((budget) => budget.id !== transferForm.value.budgetId)
    .map((budget) => ({ label: budget.name, value: budget.id })),
])
const transferDirectionOptions = computed(() => [
  { label: 'Aus diesem Umschlag', value: 'out' },
  { label: 'In diesen Umschlag', value: 'in' },
])
// Kein Saldo-Limit (ADR-0005), nur ein Hinweis, wenn der Saldo dadurch
// negativ wird.
const transferOverdraws = computed(() =>
  transferForm.value.direction === 'out'
  && transferBudget.value !== null
  && transferForm.value.amount !== null
  && Math.round(transferForm.value.amount * 100) > balanceOf(transferBudget.value),
)

/**
 * `preset` belegt den Dialog vor — z. B. "Ausgleichen" bei negativem Saldo:
 * Richtung in den Umschlag, Betrag = Ueberziehung. Ohne Preset der haeufigste
 * Fall: positiven Saldo weitergeben.
 */
function openTransfer(budget: EnvelopeItem, preset?: { direction: 'out' | 'in'; amountCents: number }) {
  const defaultCents = preset ? preset.amountCents : balanceOf(budget)
  transferForm.value = {
    budgetId: budget.id,
    counterpartId: '',
    direction: preset?.direction ?? 'out',
    amount: defaultCents > 0 ? defaultCents / 100 : null,
    date: new Date(),
    note: '',
  }
  transferError.value = null
  transferDialogOpen.value = true
}

async function saveTransfer() {
  if (!transferBudget.value) return
  if (transferForm.value.amount == null || transferForm.value.amount <= 0) {
    transferError.value = 'Betrag muss größer als 0 sein.'
    return
  }
  if (!transferForm.value.date) {
    transferError.value = 'Bitte ein Datum wählen.'
    return
  }
  transferSaving.value = true
  transferError.value = null
  try {
    const own = transferBudget.value.id
    const other = transferForm.value.counterpartId || null
    await $fetch(`/api/households/${props.householdId}/transfers`, {
      method: 'POST',
      body: {
        fromEnvelopeId: transferForm.value.direction === 'out' ? own : other,
        toEnvelopeId: transferForm.value.direction === 'out' ? other : own,
        amount: transferForm.value.amount,
        date: formatDateToInputString(transferForm.value.date),
        note: transferForm.value.note || `Umbuchung ${transferBudget.value.name}`,
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
    :header="budgetEditId ? 'Umschlag bearbeiten' : 'Umschlag anlegen'"
    :submit-label="budgetEditId ? 'Umschlag aktualisieren' : 'Umschlag anlegen'"
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
    submit-label="Umschlag schließen"
    submit-severity="danger"
    :saving="closeSaving"
    @save="saveClose"
    @cancel="closeDialogOpen = false"
  >
    <!-- ADR-0004: Wiederoeffnen ist nicht vorgesehen — das muss vor dem Klick klar sein. -->
    <Message severity="warn" variant="simple" class="dialog-irreversible">
      Schließen ist nicht umkehrbar: Ein geschlossener Umschlag lässt sich nicht wieder öffnen.
    </Message>
    <p class="dialog-hint">
      Ab dem Stichtag bekommt der Umschlag keine Zuteilungen mehr und nimmt keine Buchungen mehr an.
      Sein Saldo ({{ formatMoney(balanceOf(closingBudget)) }}) fließt ins Ziel — auch spätere Korrekturen von Buchungen vor dem Stichtag.
      Für einen Wechsel der Frequenz zuerst den neuen Umschlag anlegen, dann den alten hinein schließen.
    </p>
    <FormFieldRow label="Stichtag" html-for="close-date">
      <DatePicker id="close-date" v-model="closeForm.closedAt" show-icon date-format="dd.mm.yy" />
    </FormFieldRow>
    <FormFieldRow label="Ziel" html-for="close-target" wide>
      <Select
        id="close-target"
        v-model="closeForm.targetId"
        :options="closeTargetOptions"
        option-label="label"
        option-value="value"
        placeholder="Ziel wählen"
      />
    </FormFieldRow>
    <Message v-if="closeError" severity="error" variant="simple">{{ closeError }}</Message>
  </FormDialog>

  <!-- ADR-0005: Umbuchung zwischen Umschlaegen oder mit "Zu verteilen". -->
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
    <FormFieldRow :label="transferForm.direction === 'out' ? 'Nach' : 'Von'" html-for="transfer-counterpart" wide>
      <Select
        id="transfer-counterpart"
        v-model="transferForm.counterpartId"
        :options="transferCounterpartOptions"
        option-label="label"
        option-value="value"
        placeholder="Zu verteilen"
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
      Der Saldo des Umschlags wird dadurch negativ.
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

.dialog-irreversible {
  margin-bottom: 8px;
}
</style>
