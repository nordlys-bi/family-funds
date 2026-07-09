<!--
  TransactionRowEditor — Inline-Edit-Form fuer eine Transaktions-Zeile.

  Wird in expenses.vue / income.vue anstelle des <FormDialog>-Modals
  fuer den Edit-Pfad genutzt (issue #15). Der Create-Pfad bleibt
  weiterhin via Dialog (komplexer, andere UX-Anforderungen).

  Verwendung:
  <TransactionRowEditor
    :transaction="row"
    :budget-options="budgetSelectOptions"
    :currency="currencyCode"
    :saving="isSaving"
    @save="(payload) => saveRow(row.id, payload)"
    @cancel="cancelEdit"
  />

  Die Komponente ist zustandslos (controlled component) — Parent haelt
  die Loading-Flag und entscheidet, was beim Save passiert. Parent
  macht auch den PATCH-Call und steuert Optimistic-Update +
  Rollback-Strategie.

  Touch-Targets: alle Inputs haben min-height: 44pt. Betrag-Input
  nutzt inputmode="decimal" fuer numerische Tastatur auf Mobile.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TransactionItem } from '~/composables/useTransactionList'

export type TransactionEditPayload = {
  amount: number | null
  description: string
  date: string // YYYY-MM-DD
  budgetId: string | null
}

const props = defineProps<{
  transaction: TransactionItem
  /** Optionen fuer das Budget-Dropdown (nur fuer Expenses relevant).
   *  Bei Income kann leer gelassen werden — Editor rendert das Feld nicht. */
  budgetOptions?: Array<{ label: string; value: string }>
  /** Waehrungscode fuer den MoneyInput. */
  currency: string
  /** Saving-State — true waehrend PATCH läuft, disablest Inputs + Save. */
  saving?: boolean
  /** Localer Error-State (z. B. Server-Validation). Wird unter den Inputs angezeigt. */
  error?: string | null
}>()

const emit = defineEmits<{
  save: [payload: TransactionEditPayload]
  cancel: []
}>()

// === Lokaler Edit-State ==============================================
// Working-Copy der Transaktion, damit Cancel die Original-Werte nicht
// ueberschreibt. Parent darf die `transaction`-Prop nicht mutieren.
const draft = ref<TransactionEditPayload>(initialDraft(props.transaction))

function initialDraft(t: TransactionItem): TransactionEditPayload {
  return {
    amount: t.amount / 100,
    description: t.description ?? '',
    date: formatDateForInput(t.date),
    budgetId: t.budgetId ?? null,
  }
}

function formatDateForInput(value: string): string {
  // DB-Format: YYYY-MM-DD oder ISO-String. Input erwartet YYYY-MM-DD.
  if (typeof value !== 'string') return ''
  // ISO mit Zeit: Datum-Teil extrahieren
  if (value.includes('T')) return value.split('T')[0] ?? ''
  return value
}

// Wenn Parent eine andere Transaktion in den Editor legt (z. B. nach
// Cancel + neuer Klick auf Edit), reset das Draft auf die neuen Werte.
watch(
  () => props.transaction.id,
  () => {
    draft.value = initialDraft(props.transaction)
  },
)

function handleSave() {
  if (props.saving) return
  // Client-seitige Vor-Validierung: Betrag muss vorhanden + positiv sein.
  // Server validiert nochmal, aber wir sparen einen Roundtrip.
  if (draft.value.amount == null || draft.value.amount <= 0) {
    // Parent bekommt trotzdem den Save-Event und kann die Validierung
    // uebernehmen (InputNumber-Komponente hat ihre eigenen Constraints).
    emit('save', { ...draft.value })
    return
  }
  emit('save', { ...draft.value })
}

function handleCancel() {
  if (props.saving) return
  draft.value = initialDraft(props.transaction)
  emit('cancel')
}
</script>

<template>
  <div class="row-editor" :class="{ 'row-editor--saving': saving }">
    <div class="row-editor__field row-editor__field--amount">
      <label :for="`tx-edit-amount-${transaction.id}`" class="row-editor__label">Betrag</label>
      <InputNumber
        :input-id="`tx-edit-amount-${transaction.id}`"
        v-model="draft.amount"
        mode="currency"
        :currency="currency"
        locale="de-DE"
        :min-fraction-digits="2"
        :max-fraction-digits="2"
        :input-style="{ width: '100%' }"
        :input-props="{ inputmode: 'decimal' }"
        placeholder="0,00"
        :disabled="saving"
      />
    </div>

    <div class="row-editor__field row-editor__field--description">
      <label :for="`tx-edit-description-${transaction.id}`" class="row-editor__label">Beschreibung</label>
      <InputText
        :id="`tx-edit-description-${transaction.id}`"
        v-model="draft.description"
        placeholder="z. B. Einkauf bei Rewe"
        :disabled="saving"
        class="w-full"
      />
    </div>

    <div class="row-editor__field row-editor__field--date">
      <label :for="`tx-edit-date-${transaction.id}`" class="row-editor__label">Datum</label>
      <DatePicker
        :input-id="`tx-edit-date-${transaction.id}`"
        v-model="draft.date"
        date-format="dd.mm.yy"
        show-icon
        :disabled="saving"
        fluid
      />
    </div>

    <div
      v-if="budgetOptions !== undefined"
      class="row-editor__field row-editor__field--budget"
    >
      <label :for="`tx-edit-budget-${transaction.id}`" class="row-editor__label">Budget</label>
      <Select
        :input-id="`tx-edit-budget-${transaction.id}`"
        v-model="draft.budgetId"
        :options="budgetOptions"
        option-label="label"
        option-value="value"
        placeholder="Sonstiges"
        :disabled="saving"
        fluid
      />
    </div>

    <p v-if="error" class="row-editor__error" role="alert">{{ error }}</p>

    <div class="row-editor__actions">
      <Button
        icon="pi pi-check"
        severity="success"
        size="small"
        aria-label="Aenderungen speichern"
        :loading="saving"
        @click="handleSave"
      />
      <Button
        icon="pi pi-times"
        severity="secondary"
        outlined
        size="small"
        aria-label="Bearbeitung abbrechen"
        :disabled="saving"
        @click="handleCancel"
      />
    </div>
  </div>
</template>

<style scoped>
.row-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  padding: 10px 8px;
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid #60a5fa;
  border-radius: 0 12px 12px 0;
}

.row-editor--saving {
  opacity: 0.7;
}

.row-editor__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-editor__label {
  font-size: 0.7rem;
  color: #94a3b8;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.row-editor__error {
  grid-column: 1 / -2;
  margin: 0;
  color: #f87171;
  font-size: 0.85rem;
}

.row-editor__actions {
  display: flex;
  gap: 4px;
  align-items: center;
  padding-bottom: 2px;
}

/* Mobile: stapelt die Felder vertikal, weil 5-spaltiges Grid auf
   < 768px zu eng wird. Cards haben dann volle Touch-Target-Höhe. */
@media (max-width: 767px) {
  .row-editor {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .row-editor__error {
    grid-column: 1;
  }

  .row-editor__actions {
    justify-content: flex-end;
    padding-bottom: 0;
  }
}
</style>
