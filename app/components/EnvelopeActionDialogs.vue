<!--
  EnvelopeActionDialogs — Anlegen/Bearbeiten, Schließen, Umbuchen und Löschen
  eines Umschlags (ADR-0005). Ausgelagert aus der frueheren Umschlag-Seite,
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
import { ENVELOPE_GROUPS, isEnvelopeOpenOn, type EnvelopeGroup } from '~/utils/envelope-options'

const props = defineProps<{
  householdId: string
  /** Alle Umschlaege des Haushalts (auch geschlossene) — fuer Ziel-Auswahl und Namen. */
  envelopes: EnvelopeItem[]
  currency: string
}>()

const emit = defineEmits<{
  /** Daten haben sich geaendert, Seite soll neu laden. */
  changed: []
  notice: [notice: Notice]
  /** Umschlag wurde geloescht (Detailseite navigiert dann zur Liste). */
  deleted: [envelopeId: string]
}>()

const confirm = useAskConfirm()
const formatMoney = (value: number) => formatMoneyFromCents(value, props.currency)
const balanceOf = (envelope: EnvelopeItem | null) => envelope?.balance.balance ?? 0
const envelopesById = computed(() => new Map(props.envelopes.map((envelope) => [envelope.id, envelope] as const)))

// === Anlegen / Bearbeiten =============================================
const envelopeDialogOpen = ref(false)
const envelopeSaving = ref(false)
const envelopeEditId = ref<string | null>(null)
const blankForm = (group: EnvelopeGroup) => ({
  name: '',
  group,
  allocationSource: defaultAllocationOf(group),
  amount: null as number | null,
  targetAmount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
})
const envelopeForm = ref(blankForm('RUNNING'))

function defaultAllocationOf(group: EnvelopeGroup) {
  return ENVELOPE_GROUPS.find((item) => item.value === group)?.defaultAllocation ?? 'NONE'
}

function openCreate(group: EnvelopeGroup = 'RUNNING') {
  envelopeEditId.value = null
  envelopeForm.value = blankForm(group)
  envelopeDialogOpen.value = true
}

function openEdit(envelope: EnvelopeItem) {
  envelopeEditId.value = envelope.id
  envelopeForm.value = {
    name: envelope.name,
    group: envelope.group,
    allocationSource: envelope.allocationSource,
    amount: envelope.allocationAmount === null ? null : envelope.allocationAmount / 100,
    targetAmount: envelope.targetAmount === null ? null : envelope.targetAmount / 100,
    frequency: envelope.frequency,
    validFrom: new Date(envelope.balanceSince),
  }
  envelopeDialogOpen.value = true
}

// Die Gruppe setzt beim Anlegen die Zuteilung vor (ADR-0005); danach darf man
// sie frei aendern. Beim Bearbeiten aendert ein Gruppenwechsel nichts daran.
watch(
  () => envelopeForm.value.group,
  (group) => {
    if (!envelopeEditId.value) envelopeForm.value.allocationSource = defaultAllocationOf(group)
  },
)

watch(
  () => envelopeForm.value.frequency,
  (frequency) => {
    if (!envelopeEditId.value) {
      envelopeForm.value.validFrom = getPeriodStartDate(new Date(), frequency)
    }
  },
)

async function saveEnvelope() {
  envelopeSaving.value = true
  try {
    const isEdit = Boolean(envelopeEditId.value)
    // Ein neuer Betrag wirkt ab der naechsten noch nicht gebuchten Periode
    // (ADR-0005); Frequenz und Start sind nach dem Anlegen fest.
    const rule = {
      name: envelopeForm.value.name,
      group: envelopeForm.value.group,
      allocationSource: envelopeForm.value.allocationSource,
      allocationAmount: envelopeForm.value.allocationSource === 'FIXED' ? envelopeForm.value.amount : null,
      targetAmount: envelopeForm.value.targetAmount || null,
    }
    if (envelopeEditId.value) {
      await $fetch(`/api/households/${props.householdId}/envelopes/${envelopeEditId.value}`, { method: 'PATCH', body: rule })
    } else {
      await $fetch(`/api/households/${props.householdId}/envelopes`, {
        method: 'POST',
        body: {
          ...rule,
          frequency: envelopeForm.value.allocationSource === 'NONE' ? 'MONTHLY' : envelopeForm.value.frequency,
          balanceSince: formatDateToInputString(
            envelopeForm.value.allocationSource === 'NONE'
              ? getPeriodStartDate(envelopeForm.value.validFrom, 'MONTHLY')
              : envelopeForm.value.validFrom,
          ),
        },
      })
    }
    envelopeDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: isEdit ? 'Umschlag wurde aktualisiert.' : 'Umschlag wurde angelegt.' })
  } catch (error: any) {
    emit('notice', { severity: 'error', text: 'Umschlag konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) })
  } finally {
    envelopeSaving.value = false
  }
}

// === Löschen ==========================================================
const deletingId = ref<string | null>(null)

async function remove(envelope: EnvelopeItem) {
  // ConfirmSheet (issue #51): kein Undo fuer Umschläge, also ist der Sheet
  // die einzige Sicherung gegen Fehlklicks.
  const ok = await confirm.ask({
    title: 'Umschlag löschen?',
    message: `„${envelope.name}" wird endgültig entfernt. Das geht nur, solange noch nichts darauf gebucht wurde — sonst den Umschlag stattdessen schließen.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  deletingId.value = envelope.id
  try {
    await $fetch(`/api/households/${props.householdId}/envelopes/${envelope.id}`, { method: 'DELETE' })
    emit('deleted', envelope.id)
    emit('changed')
    emit('notice', { severity: 'success', text: `„${envelope.name}" wurde gelöscht.` })
  } catch (error: any) {
    // ADR-0004: 409 = Umschlag hat Buchungen, Umbuchungen oder Vorgaenger.
    emit('notice', error.statusCode === 409
      ? { severity: 'warn', text: `„${envelope.name}" hat bereits Buchungen und kann nicht gelöscht werden. Schließe ihn stattdessen.` }
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
  envelopeId: '',
  closedAt: new Date() as Date | null,
  targetId: null as string | null,
})
const closingEnvelope = computed(() => envelopesById.value.get(closeForm.value.envelopeId) ?? null)
const closeDialogHeader = computed(() => `„${closingEnvelope.value?.name ?? ''}“ schließen`)
// Ziel: "Zu verteilen" oder ein anderer Umschlag, der am Stichtag noch offen
// ist; Zyklen lehnt der Server ab. Eigener Wert statt '', weil das Ziel bewusst gewaehlt
// sein muss und '' im Select wie "nichts gewaehlt" aussaehe.
const UNASSIGNED_TARGET = 'unassigned'
const closeTargetOptions = computed(() => [
  { label: 'Zu verteilen', value: UNASSIGNED_TARGET },
  ...props.envelopes
    .filter((envelope) => envelope.id !== closeForm.value.envelopeId && (!envelope.closedAt || (closeForm.value.closedAt && isEnvelopeOpenOn(envelope, closeForm.value.closedAt))))
    .map((envelope) => ({ label: envelope.name, value: envelope.id })),
])

function openClose(envelope: EnvelopeItem) {
  closeForm.value = {
    envelopeId: envelope.id,
    closedAt: getNextPeriodStartDate(new Date(), envelope.frequency),
    targetId: null,
  }
  closeError.value = null
  closeDialogOpen.value = true
}

async function saveClose() {
  if (!closingEnvelope.value) return
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
    await $fetch(`/api/households/${props.householdId}/envelopes/${closingEnvelope.value.id}/close`, {
      method: 'POST',
      body: {
        closedAt: formatDateToInputString(closeForm.value.closedAt),
        carryoverToEnvelopeId: closeForm.value.targetId === UNASSIGNED_TARGET ? null : closeForm.value.targetId,
      },
    })
    closeDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: `„${closingEnvelope.value?.name ?? 'Umschlag'}" wurde geschlossen.` })
  } catch (error: any) {
    const reason = error.data?.data?.reason
    closeError.value = reason === 'active-plans'
      ? 'An diesem Umschlag hängen noch Pläne, die über den Stichtag hinaus laufen. Bitte zuerst umhängen oder beenden.'
      : reason === 'carryover-cycle'
        ? 'Das Ziel fließt selbst schon in diesen Umschlag. Bitte ein anderes Ziel wählen.'
        : error.statusCode === 409
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
  envelopeId: '',
  counterpartId: '',
  direction: 'out' as 'out' | 'in',
  amount: null as number | null,
  date: new Date() as Date | null,
  note: '',
})
const transferEnvelope = computed(() => envelopesById.value.get(transferForm.value.envelopeId) ?? null)
const transferDialogHeader = computed(() => `Umbuchen: ${transferEnvelope.value?.name ?? ''}`)
const transferNotePlaceholder = computed(() => `Umbuchung ${transferEnvelope.value?.name ?? ''}`)
const transferCounterpartOptions = computed(() => [
  { label: 'Zu verteilen', value: '' },
  ...sortEnvelopes(envelopesBookableOn(props.envelopes, transferForm.value.date))
    .filter((envelope) => envelope.id !== transferForm.value.envelopeId)
    .map((envelope) => ({ label: envelope.name, value: envelope.id })),
])
const transferDirectionOptions = computed(() => [
  { label: 'Aus diesem Umschlag', value: 'out' },
  { label: 'In diesen Umschlag', value: 'in' },
])
// Kein Saldo-Limit (ADR-0005), nur ein Hinweis, wenn der Saldo dadurch
// negativ wird.
const transferOverdraws = computed(() =>
  transferForm.value.direction === 'out'
  && transferEnvelope.value !== null
  && transferForm.value.amount !== null
  && Math.round(transferForm.value.amount * 100) > balanceOf(transferEnvelope.value),
)

/**
 * `preset` belegt den Dialog vor — z. B. "Ausgleichen" bei negativem Saldo:
 * Richtung in den Umschlag, Betrag = Ueberziehung. Ohne Preset der haeufigste
 * Fall: positiven Saldo weitergeben.
 */
function openTransfer(envelope: EnvelopeItem, preset?: { direction: 'out' | 'in'; amountCents: number }) {
  const defaultCents = preset ? preset.amountCents : balanceOf(envelope)
  transferForm.value = {
    envelopeId: envelope.id,
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
  if (!transferEnvelope.value) return
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
    const own = transferEnvelope.value.id
    const other = transferForm.value.counterpartId || null
    await $fetch(`/api/households/${props.householdId}/transfers`, {
      method: 'POST',
      body: {
        fromEnvelopeId: transferForm.value.direction === 'out' ? own : other,
        toEnvelopeId: transferForm.value.direction === 'out' ? other : own,
        amount: transferForm.value.amount,
        date: formatDateToInputString(transferForm.value.date),
        note: transferForm.value.note || `Umbuchung ${transferEnvelope.value.name}`,
      },
    })
    transferDialogOpen.value = false
    emit('changed')
    emit('notice', { severity: 'success', text: 'Umbuchung wurde gespeichert.' })
  } catch (error: any) {
    transferError.value = error.data?.data?.reason === 'before-ledger'
      ? 'Das Datum liegt vor dem Start von „Zu verteilen“. Bitte ein späteres Datum wählen.'
      : 'Umbuchung fehlgeschlagen: ' + (error.statusMessage || error.message)
  } finally {
    transferSaving.value = false
  }
}

defineExpose({ openCreate, openEdit, openClose, openTransfer, remove, deletingId })
</script>

<template>
  <FormDialog
    v-model:visible="envelopeDialogOpen"
    :header="envelopeEditId ? 'Umschlag bearbeiten' : 'Umschlag anlegen'"
    :submit-label="envelopeEditId ? 'Umschlag aktualisieren' : 'Umschlag anlegen'"
    :saving="envelopeSaving"
    @save="saveEnvelope"
    @cancel="envelopeDialogOpen = false"
  >
    <EnvelopeForm v-model="envelopeForm" :currency="currency" :frequency-locked="Boolean(envelopeEditId)" />
  </FormDialog>

  <!-- ADR-0004: Umschlag schließen — Saldo fließt per Verweis ins Ziel. -->
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
      Sein Saldo ({{ formatMoney(balanceOf(closingEnvelope)) }}) fließt ins Ziel — auch spätere Korrekturen von Buchungen vor dem Stichtag.
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
    <p class="dialog-hint">Aktueller Saldo: {{ formatMoney(balanceOf(transferEnvelope)) }}</p>
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
