<!--
  TransactionRowEditor — Inline-Edit-Form fuer eine Transaktions-Zeile.

  Wird in expenses.vue / income.vue anstelle des <FormDialog>-Modals
  fuer den Edit-Pfad genutzt (issue #15). Der Create-Pfad bleibt
  weiterhin via Dialog (komplexer, andere UX-Anforderungen).

  Verwendung:
  <TransactionRowEditor
    :transaction="row"
    :envelope-options="envelopeOptions"
    :accounts="accounts"
    :binding-of="bindingOf"
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
import { computed, ref, watch } from 'vue'
import type { TransactionItem } from '~/composables/useTransactionList'
import { fromDateInputValue, toDateInputValue } from '~/utils/form-helpers'
import { isEnvelopeBookableOn, type EnvelopeGroup } from '~/utils/envelope-options'
import type { AccountBinding, PaidWithAccount } from '~/utils/account-options'

export type TransactionEditPayload = {
  amount: number | null
  description: string
  date: string // YYYY-MM-DD
  envelopeId: string | null
  /** Nur gesetzt, wenn der Editor das Konto-Feld zeigt (`accounts`). */
  accountId?: string | null
}

const props = defineProps<{
  transaction: TransactionItem
  /** Optionen fuer das Umschlag-Dropdown. Ohne diese Prop rendert der Editor
   *  das Feld nicht. */
  envelopeOptions?: Array<{ label: string; value: string; group?: EnvelopeGroup; balanceSince?: string | Date; closedAt?: string | Date | null }>
  /** ADR-0006: Konten fuer "Bezahlt mit"; leer oder fehlend = kein Feld. */
  accounts?: PaidWithAccount[]
  /** Kontobindung eines Umschlags (Eingabefilter). */
  bindingOf?: (envelopeId: string | null) => AccountBinding | null
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
// Das Datum liegt im Draft als `Date`, weil der DatePicker nach einer
// Auswahl ohnehin ein `Date` zurueckschreibt — erst beim Speichern wird es
// wieder zu 'YYYY-MM-DD' (sonst landet ein UTC-ISO-String im PATCH, den
// der Server als ungueltiges Datum ablehnt).
type EditDraft = Omit<TransactionEditPayload, 'date'> & { date: Date | null }

const draft = ref<EditDraft>(initialDraft(props.transaction))

function initialDraft(t: TransactionItem): EditDraft {
  return {
    amount: t.amount / 100,
    description: t.description ?? '',
    date: fromDateInputValue(t.date),
    envelopeId: t.envelopeId ?? null,
    accountId: t.accountId ?? null,
  }
}

const showAccount = computed(() => (props.accounts?.length ?? 0) > 0)
const binding = computed(() => props.bindingOf?.(draft.value.envelopeId) ?? null)

function toPayload(value: EditDraft): TransactionEditPayload {
  const { accountId, ...rest } = value
  // Ohne Feld kein `accountId` im PATCH: Der Server laesst das Konto dann,
  // wie es ist, statt es zu leeren.
  return { ...rest, date: toDateInputValue(value.date), ...(showAccount.value ? { accountId: accountId ?? null } : {}) }
}

// ADR-0005: Umschlaege nur anbieten, wenn das Entwurfs-Datum in ihre Laufzeit
// faellt. "Zu verteilen" hat keine Laufzeit. Der aktuell gesetzte Umschlag
// bleibt sichtbar, damit der Select nicht leer wirkt — speichern mit einem
// unpassenden Datum lehnt der Server ab und der Fehler erscheint unten.
const availableEnvelopeOptions = computed(() =>
  props.envelopeOptions?.filter((option) => {
    if (!option.balanceSince || option.value === (draft.value.envelopeId ?? '')) return true
    if (!draft.value.date) return !option.closedAt
    return isEnvelopeBookableOn({ balanceSince: option.balanceSince, closedAt: option.closedAt }, draft.value.date)
  }),
)

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
    emit('save', toPayload(draft.value))
    return
  }
  emit('save', toPayload(draft.value))
}

function handleCancel() {
  if (props.saving) return
  draft.value = initialDraft(props.transaction)
  emit('cancel')
}
</script>

<template>
  <div class="row-editor" :class="{ 'row-editor--saving': saving, 'row-editor--account': showAccount }">
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
      v-if="envelopeOptions !== undefined"
      class="row-editor__field row-editor__field--envelope"
    >
      <label :for="`tx-edit-envelope-${transaction.id}`" class="row-editor__label">Umschlag</label>
      <EnvelopeSelect
        :input-id="`tx-edit-envelope-${transaction.id}`"
        v-model="draft.envelopeId"
        :options="availableEnvelopeOptions"
        option-label="label"
        option-value="value"
        placeholder="Zu verteilen"
        :disabled="saving"
        fluid
      />
    </div>

    <div v-if="showAccount" class="row-editor__field row-editor__field--account">
      <label :for="`tx-edit-account-${transaction.id}`" class="row-editor__label">
        {{ transaction.kind === 'income' ? 'Eingang auf' : 'Bezahlt mit' }}
      </label>
      <PaidWithSelect
        v-model="draft.accountId"
        :input-id="`tx-edit-account-${transaction.id}`"
        :accounts="accounts ?? []"
        :date="draft.date"
        :binding="binding"
        :disabled="saving"
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

.row-editor--account {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
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
  color: var(--color-text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.row-editor__error {
  grid-column: 1 / -2;
  margin: 0;
  color: var(--color-accent-danger-text);
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
  .row-editor,
  .row-editor--account {
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
