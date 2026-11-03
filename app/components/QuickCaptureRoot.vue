<!--
  QuickCaptureRoot — globaler Mount-Point fuer useQuickCapture (issue #91).

  Wird EINMAL in `app/app.vue` eingebunden (neben <ConfirmSheetRoot />).
  Rendert den Erfassen-Dialog nur, wenn useQuickCapture().isOpen true ist,
  und macht den POST auf /api/households/{id}/transactions selbst.

  Architektur: useQuickCapture haelt den State, diese Root-Komponente ist
  die Bruecke zum FormDialog + der API. Nach Erfolg bumpt sie savedTick,
  damit Listen-Seiten (expenses/income/index) neu laden koennen.

  Warum hier und nicht als Page-Dialog: die Aktion soll von jeder Seite
  aus verfuegbar sein (Header-Button, Tastenkuerzel "e", Mobile-FAB) —
  ohne vorher zu /transactions/* zu navigieren.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { todayDateHelperText } from '~/utils/form-helpers'

const { isOpen, kind, envelopeId: prefillEnvelopeId, close, setKind, markSaved } = useQuickCapture()
const { activeHousehold } = useHousehold()

// PrimeVue useToast wirft ohne ToastService-Provide (SSR / Tests). Der
// try/catch-Fallback haelt die Komponente robust — analog useUndoableDelete.
const toast: { add: (msg: unknown) => void } = (() => {
  try {
    return useToast() as unknown as { add: (msg: unknown) => void }
  } catch {
    return { add: () => {} }
  }
})()

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')

const isExpense = computed(() => kind.value === 'expense')
const isTransfer = computed(() => kind.value === 'transfer')
const header = computed(() => ({ expense: 'Neue Ausgabe', income: 'Neue Einnahme', transfer: 'Neue Umbuchung' })[kind.value])
const submitLabel = computed(() => ({ expense: 'Ausgabe anlegen', income: 'Einnahme anlegen', transfer: 'Umbuchen' })[kind.value])
const submitSeverity = computed<'success'>(() => 'success')

const kindOptions = [
  { label: 'Ausgabe', value: 'expense' as const },
  { label: 'Einnahme', value: 'income' as const },
  { label: 'Umbuchung', value: 'transfer' as const },
]

// '' ist in allen drei Umschlag-Feldern "Zu verteilen".
const form = ref({
  amount: null as number | null,
  description: '',
  date: new Date() as Date,
  envelopeId: '' as string,
  fromEnvelopeId: '' as string,
  toEnvelopeId: '' as string,
})
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const { envelopes, unassignedFree, ledgerSince, loaded: envelopesLoaded, failed: envelopesFailed, load: loadEnvelopes } = useEnvelopeOptions()
// ADR-0005: Nur Umschlaege anbieten, die am Buchungsdatum Buchungen annehmen.
const envelopeSelectOptions = computed(() => [
  { label: 'Zu verteilen', value: '' },
  ...envelopesBookableOn(envelopes.value, form.value.date).map((envelope) => ({ label: envelope.name, value: envelope.id })),
])

// Faellt der gewaehlte Umschlag durch einen Datumswechsel weg, auf "Zu
// verteilen" zuruecksetzen statt eine Auswahl zu behalten, die der Server mit
// 400 ablehnt. Erst nach dem Laden: Vorher enthaelt die Liste nur "Zu
// verteilen", und ein vorausgewaehlter Umschlag (Dashboard-Karte) wuerde beim
// ersten Oeffnen sofort wieder geleert.
watch(envelopeSelectOptions, (options) => {
  if (!envelopesLoaded.value) return
  const isOffered = (id: string) => options.some((option) => option.value === id)
  if (!isOffered(form.value.envelopeId)) form.value.envelopeId = ''
  if (!isOffered(form.value.fromEnvelopeId)) form.value.fromEnvelopeId = ''
  if (!isOffered(form.value.toEnvelopeId)) form.value.toEnvelopeId = ''
})

// Kein Limit auf den verfuegbaren Saldo (ADR-0005), aber ein Hinweis, wenn die
// Quelle dadurch ins Minus rutscht. Bei "Zu verteilen" zaehlt das freie Geld.
const transferSourceBalance = computed(() => {
  if (!form.value.fromEnvelopeId) return unassignedFree.value
  return envelopes.value.find((envelope) => envelope.id === form.value.fromEnvelopeId)?.balance.balance ?? null
})
const transferOverdraws = computed(() =>
  isTransfer.value
  && form.value.amount != null
  && transferSourceBalance.value != null
  && Math.round(form.value.amount * 100) > transferSourceBalance.value,
)

// ADR-0005: Vor dem Start von "Zu verteilen" zaehlt eine Buchung ohne Umschlag
// nur in den Auswertungen; eine Umbuchung lehnt der Server dort ab.
const beforeLedger = computed(() => Boolean(ledgerSince.value && form.value.date && isBeforeLedger(form.value.date, ledgerSince.value)))
const ledgerStartLabel = computed(() => formatPlanningDate(ledgerSince.value))
const transferBeforeLedger = computed(() =>
  isTransfer.value && beforeLedger.value && (!form.value.fromEnvelopeId || !form.value.toEnvelopeId),
)
const bookingBeforeLedger = computed(() => !isTransfer.value && beforeLedger.value && !form.value.envelopeId)

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`
}

function resetForm() {
  form.value = { amount: null, description: '', date: new Date(), envelopeId: '', fromEnvelopeId: '', toEnvelopeId: '' }
  errorMessage.value = null
}

watch(isOpen, (open) => {
  if (open) {
    resetForm()
    // Vorausgewaehlter Umschlag (z. B. von einer Dashboard-Karte) NACH dem
    // Reset setzen, sonst wird er sofort wieder auf '' geleert.
    if (prefillEnvelopeId.value) form.value.envelopeId = prefillEnvelopeId.value
    loadEnvelopes(activeHouseholdId.value)
  }
})

function onKindChange(value: 'expense' | 'income' | 'transfer' | null) {
  if (!value) return
  setKind(value)
}

function onDialogVisible(value: boolean) {
  if (!value) close()
}

function bookingRequest() {
  const householdPath = `/api/households/${activeHouseholdId.value}`
  if (isTransfer.value) {
    return {
      url: `${householdPath}/transfers`,
      body: {
        fromEnvelopeId: form.value.fromEnvelopeId || null,
        toEnvelopeId: form.value.toEnvelopeId || null,
        amount: form.value.amount,
        note: form.value.description,
        date: formatDateInput(form.value.date),
      },
    }
  }
  return {
    url: `${householdPath}/transactions`,
    body: {
      kind: kind.value,
      amount: form.value.amount,
      description: form.value.description,
      date: formatDateInput(form.value.date),
      envelopeId: form.value.envelopeId || null,
    },
  }
}

function savedToast() {
  if (isTransfer.value) return { summary: 'Umbuchung erfasst', detail: 'Umbuchung gespeichert.' }
  const label = isExpense.value ? 'Ausgabe' : 'Einnahme'
  return { summary: `${label} erfasst`, detail: `${form.value.description || label} gespeichert.` }
}

async function save() {
  if (!activeHouseholdId.value) {
    errorMessage.value = 'Kein aktiver Haushalt.'
    return
  }
  if (form.value.amount == null || form.value.amount <= 0) {
    errorMessage.value = 'Betrag muss groesser als 0 sein.'
    return
  }
  if (isTransfer.value && form.value.fromEnvelopeId === form.value.toEnvelopeId) {
    errorMessage.value = 'Quelle und Ziel müssen sich unterscheiden.'
    return
  }
  if (transferBeforeLedger.value) {
    errorMessage.value = `„Zu verteilen“ startet am ${ledgerStartLabel.value}. Bitte ein späteres Datum wählen.`
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    const { url, body } = bookingRequest()
    await $fetch(url, { method: 'POST', body })
    toast.add({ severity: 'success', ...savedToast(), life: 3000 })
    markSaved()
    close()
    resetForm()
  } catch (error: any) {
    errorMessage.value =
      error?.statusMessage || error?.message || 'Buchung konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormDialog
    v-if="isOpen"
    :visible="isOpen"
    :header="header"
    :submit-label="submitLabel"
    :submit-severity="submitSeverity"
    :saving="saving"
    width="min(40rem, 94vw)"
    @update:visible="onDialogVisible"
    @save="save"
    @cancel="close"
  >
    <div class="quick-capture__kind">
      <SelectButton
        :model-value="kind"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        aria-label="Art der Buchung"
        @update:model-value="onKindChange"
      />
    </div>

    <Message v-if="errorMessage" severity="error" variant="simple" class="quick-capture__error">
      {{ errorMessage }}
    </Message>

    <FormFieldRow label="Betrag" html-for="quick-capture-amount">
      <MoneyInput
        id="quick-capture-amount"
        v-model="form.amount"
        :currency="currencyCode"
        :min="0"
      />
    </FormFieldRow>

    <template v-if="isTransfer">
      <FormFieldRow label="Von" html-for="quick-capture-from" wide>
        <Select
          id="quick-capture-from"
          v-model="form.fromEnvelopeId"
          :options="envelopeSelectOptions"
          option-label="label"
          option-value="value"
          placeholder="Zu verteilen"
        />
      </FormFieldRow>
      <FormFieldRow label="Nach" html-for="quick-capture-to" wide>
        <Select
          id="quick-capture-to"
          v-model="form.toEnvelopeId"
          :options="envelopeSelectOptions"
          option-label="label"
          option-value="value"
          placeholder="Zu verteilen"
        />
      </FormFieldRow>
      <Message v-if="transferOverdraws" severity="warn" variant="simple" class="quick-capture__error">
        Die Quelle rutscht dadurch ins Minus.
      </Message>
      <Message v-if="transferBeforeLedger" severity="warn" variant="simple" class="quick-capture__error">
        „Zu verteilen“ startet am {{ ledgerStartLabel }}. Umbuchungen damit sind erst ab diesem Tag möglich.
      </Message>
    </template>
    <FormFieldRow v-else label="Umschlag" html-for="quick-capture-envelope" wide>
      <Select
        id="quick-capture-envelope"
        v-model="form.envelopeId"
        :options="envelopeSelectOptions"
        option-label="label"
        option-value="value"
        placeholder="Zu verteilen"
      />
    </FormFieldRow>

    <Message v-if="envelopesFailed" severity="warn" variant="simple" class="quick-capture__error">
      Umschläge konnten nicht geladen werden.
    </Message>
    <Message v-if="bookingBeforeLedger" severity="info" variant="simple" class="quick-capture__error">
      „Zu verteilen“ startet am {{ ledgerStartLabel }}. Diese Buchung zählt nur in den Auswertungen.
    </Message>

    <FormFieldRow :label="isTransfer ? 'Notiz' : 'Beschreibung'" html-for="quick-capture-description" wide>
      <InputText
        id="quick-capture-description"
        v-model="form.description"
        :placeholder="{ expense: 'z. B. Einkauf bei Rewe', income: 'z. B. Gehalt', transfer: 'z. B. Rest vom Monat' }[kind]"
      />
    </FormFieldRow>

    <FormFieldRow label="Datum" html-for="quick-capture-date" subtle>
      <DatePicker
        id="quick-capture-date"
        v-model="form.date"
        dateFormat="dd.mm.yy"
        showIcon
        inputClass="w-full"
      />
      <small class="form-field-helper">{{ todayDateHelperText }}</small>
    </FormFieldRow>
  </FormDialog>
</template>

<style scoped>
.quick-capture__kind {
  display: flex;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.quick-capture__error {
  margin-bottom: 0.25rem;
}
</style>
