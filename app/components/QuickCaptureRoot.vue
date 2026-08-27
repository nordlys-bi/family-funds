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

type BudgetItem = { id: string; name: string }

const { isOpen, kind, close, setKind, markSaved } = useQuickCapture()
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
const header = computed(() => (isExpense.value ? 'Neue Ausgabe' : 'Neue Einnahme'))
const submitLabel = computed(() => (isExpense.value ? 'Ausgabe anlegen' : 'Einnahme anlegen'))
const submitSeverity = computed<'success'>(() => 'success')

const kindOptions = [
  { label: 'Ausgabe', value: 'expense' as const },
  { label: 'Einnahme', value: 'income' as const },
]

const form = ref({
  amount: null as number | null,
  description: '',
  date: new Date() as Date,
  budgetId: '' as string,
})
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const budgets = ref<BudgetItem[]>([])
const budgetSelectOptions = computed(() => [
  { label: 'Sonstiges', value: '' },
  ...budgets.value.map((budget) => ({ label: budget.name, value: budget.id })),
])

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`
}

function resetForm() {
  form.value = { amount: null, description: '', date: new Date(), budgetId: '' }
  errorMessage.value = null
}

// Budgets lazy laden, sobald der Dialog aufgeht (nur relevant fuer
// Ausgaben, aber der Endpoint liefert beides in einem Call). Bei
// Fehler bleibt die Liste leer — "Sonstiges" ist dann die einzige
// Option, der Dialog bleibt benutzbar.
async function loadBudgets() {
  try {
    const data = await $fetch<{ household: { budgets: BudgetItem[] } | null }>(
      '/api/households/current',
    )
    budgets.value = data.household?.budgets ?? []
  } catch {
    budgets.value = []
  }
}

watch(isOpen, (open) => {
  if (open) {
    resetForm()
    if (isExpense.value) loadBudgets()
  }
})

// Wechselt der User im Dialog die Art auf Ausgabe und wir haben noch
// keine Budgets geladen, hier nachziehen.
watch(kind, (nextKind) => {
  if (isOpen.value && nextKind === 'expense' && budgets.value.length === 0) {
    loadBudgets()
  }
})

function onKindChange(value: 'expense' | 'income' | null) {
  if (!value) return
  setKind(value)
}

function onDialogVisible(value: boolean) {
  if (!value) close()
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
  saving.value = true
  errorMessage.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'POST',
      body: {
        kind: kind.value,
        amount: form.value.amount,
        description: form.value.description,
        date: formatDateInput(form.value.date),
        ...(isExpense.value ? { budgetId: form.value.budgetId || null } : {}),
      },
    })
    toast.add({
      severity: 'success',
      summary: isExpense.value ? 'Ausgabe erfasst' : 'Einnahme erfasst',
      detail: `${form.value.description || (isExpense.value ? 'Ausgabe' : 'Einnahme')} gespeichert.`,
      life: 3000,
    })
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

    <FormFieldRow v-if="isExpense" label="Budget" html-for="quick-capture-budget" wide>
      <Select
        id="quick-capture-budget"
        v-model="form.budgetId"
        :options="budgetSelectOptions"
        option-label="label"
        option-value="value"
        placeholder="Budget wählen"
      />
    </FormFieldRow>

    <FormFieldRow label="Beschreibung" html-for="quick-capture-description" wide>
      <InputText
        id="quick-capture-description"
        v-model="form.description"
        :placeholder="isExpense ? 'z. B. Einkauf bei Rewe' : 'z. B. Gehalt'"
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
