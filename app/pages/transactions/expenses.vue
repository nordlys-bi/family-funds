<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isFirstRun } from '~/utils/household-age'

definePageMeta({ layout: 'default' })

type BudgetItem = {
  id: string
  key: string
  name: string
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
}

const { activeHousehold, fetchHouseholds } = useHousehold()
const route = useRoute()
const router = useRouter()

const currentHousehold = ref<PlanningHousehold | null>(null)
const notice = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)
const editingTransactionId = ref<string | null>(null)
const transactionDialogOpen = ref(false)
const transactionLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

// --- Month-Filter via Composable (issue #9) ---
// Initial aus URL-Query ?month=YYYY-MM, sonst aktueller Monat.
// WICHTIG: die Refs MÜSSEN top-level destructuriert werden, damit
// Vue's Template-Compiler sie auto-unwrapped. Ein `txList.monthOptions`
// wäre ein nested Ref auf einem zurückgegebenen Object und würde NICHT
// auto-unwrap — PrimeVue's Select würde dann den Ref-Proxy statt
// des Arrays bekommen und mit "findIndex is not a function" sterben.
const tx = useTransactionList({
  initialMonth: typeof route.query.month === 'string' ? route.query.month : undefined,
})
const month = tx.month
const monthOptions = tx.monthOptions
const monthLabel = tx.monthLabel
const summary = tx.summary
const txLoading = tx.loading
const txError = tx.error
const setMonth = tx.setMonth
const loadTransactions = tx.load
const transactionsByKind = tx.transactionsByKind
const updateTransactionLocal = tx.updateTransactionLocal
const restoreTransactionLocal = tx.restoreTransactionLocal
const recomputeSummaryFromLocal = tx.recomputeSummaryFromLocal

const visibleTransactions = computed(() => transactionsByKind('expense'))

// Empty-State-Variante (issue #13): wenn der Haushalt < 7 Tage alt ist
// UND noch keine Buchungen existieren, zeigen wir den First-Time-State
// mit Willkommens-Copy + CTA "Ausgabe anlegen". Bei etabliertem Haushalt
// reicht der knappe No-Data-Hinweis ohne CTA.
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const showFirstTimeEmpty = computed(
  () => visibleTransactions.value.length === 0 && isFirstRunHousehold.value,
)

const budgetOptions = computed(() => currentHousehold.value?.budgets ?? [])
const budgetSelectOptions = computed(() => [
  { label: 'Sonstiges', value: '' },
  ...budgetOptions.value.map((budget) => ({ label: budget.name, value: budget.id })),
])

const budgetLabel = (transaction: { budgetName?: string | null }) => transaction.budgetName ?? 'Sonstiges'
const isUnassigned = (transaction: { budgetId?: string | null }) => !transaction.budgetId

const transactionForm = ref({
  amount: null as number | null,
  description: '',
  date: new Date(),
  budgetId: '',
})

// Month-Spinner-Change → URL-Sync + Reload (kein Full-Page-Reload)
async function onMonthChange(newMonth: string) {
  await setMonth(newMonth, activeHouseholdId.value)
  // URL updaten (replace, kein History-Eintrag pro Monats-Klick).
  // query.month == aktueller Monat → Query loeschen, damit die Default-URL
  // sauber bleibt (kein "?month=2026-07" im Juli, wenn Juli der Default ist).
  const currentMonth = new Date().toISOString().slice(0, 7)
  const query = newMonth === currentMonth ? {} : { month: newMonth }
  await router.replace({ query })
}

// --- Daten laden ---
async function loadCurrentHousehold() {
  try {
    const current = await $fetch<{ household: PlanningHousehold | null }>('/api/households/current')
    currentHousehold.value = current.household
  } catch (error) {
    currentHousehold.value = null
  }
}

async function loadAll() {
  await Promise.all([
    loadCurrentHousehold(),
    loadTransactions(activeHouseholdId.value),
  ])
}

const resetForm = () => {
  transactionForm.value = { amount: null, description: '', date: new Date(), budgetId: '' }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const closeTransactionDialog = () => { transactionDialogOpen.value = false; resetForm() }

// === Inline-Edit (issue #15) ==========================================
// Single-Edit-Pattern: editingTransactionId haelt die ID der Zeile im
// Edit-Modus. Setzen einer neuen ID wechselt den Fokus.
const startInlineEdit = (id: string) => { editingTransactionId.value = id }
const cancelInlineEdit = () => { editingTransactionId.value = null }
const inlineEditError = ref<string | null>(null)

async function saveInlineEdit(
  transactionId: string,
  payload: { amount: number | null; description: string; date: string; budgetId: string | null },
) {
  if (!activeHouseholdId.value) return
  if (payload.amount == null || payload.amount <= 0) {
    inlineEditError.value = 'Betrag muss groesser als 0 sein.'
    return
  }
  inlineEditError.value = null
  actionLoadingKey.value = `expense:${transactionId}`

  // Optimistic Update via Composable-Helper (issue #15).
  // Composable liefert das Original zurueck für eventuellen Rollback.
  const amountCents = Math.round((payload.amount ?? 0) * 100)
  const original = updateTransactionLocal(transactionId, {
    amount: amountCents,
    description: payload.description,
    date: payload.date,
    budgetId: payload.budgetId,
  })
  if (!original) {
    actionLoadingKey.value = null
    return
  }

  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'PATCH',
      body: {
        kind: 'expense',
        id: transactionId,
        amount: amountCents,
        description: payload.description,
        date: payload.date,
        budgetId: payload.budgetId,
      },
    })
    editingTransactionId.value = null
    recomputeSummaryFromLocal()
    notice.value = { severity: 'success', text: 'Ausgabe wurde aktualisiert.' }
  } catch (error: any) {
    // Rollback auf den Original-Wert (issue #15 Acceptance Criteria).
    restoreTransactionLocal(transactionId, original)
    inlineEditError.value = error?.statusMessage || error?.message || 'Speichern fehlgeschlagen.'
  } finally {
    actionLoadingKey.value = null
  }
}

const saveTransaction = async () => {
  if (!activeHouseholdId.value) return
  transactionLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(editingTransactionId.value)
    const payload = {
      kind: 'expense' as const,
      ...(editingTransactionId.value ? { id: editingTransactionId.value } : {}),
      amount: transactionForm.value.amount ?? undefined,
      description: transactionForm.value.description,
      date: transactionForm.value.date ? formatDateInput(transactionForm.value.date) : undefined,
      budgetId: transactionForm.value.budgetId || null,
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: editingTransactionId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadAll()
    closeTransactionDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Ausgabe wurde aktualisiert.' : 'Ausgabe wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Ausgabe konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    transactionLoading.value = false
  }
}

const deleteTransaction = async (transaction: { id: string }) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `expense:${transaction.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/expenses/${transaction.id}`, {
      method: 'DELETE',
    })
    await loadAll()
    notice.value = { severity: 'success', text: 'Ausgabe wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Ausgabe konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

// Composable-Fehler in Notice mappen, damit User was sehen.
watch(txError, (error) => {
  if (error) {
    notice.value = { severity: 'error', text: 'Transaktionen konnten nicht geladen werden: ' + error }
  }
})

// ESC bricht Inline-Edit ab (issue #15 Acceptance Criteria).
function onEscapeKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && editingTransactionId.value) {
    event.preventDefault()
    cancelInlineEdit()
  }
}
onMounted(async () => {
  if (import.meta.client) {
    document.addEventListener('keydown', onEscapeKey)
  }
  await fetchHouseholds()
  await loadAll()
})
onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('keydown', onEscapeKey)
  }
})
watch(activeHouseholdId, async () => { await loadAll() })
</script>

<template>
  <ListPageShell
    title="Ausgaben"
    :description="`Erfasse alle Ausgaben fuer ${monthLabel}. Filtere nach Monat oder lege neue Buchungen an.`"
  >
    <template #summary>
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(summary.expenseTotal)}`" />
      <Tag severity="secondary" :value="`Ohne Budget ${formatMoney(summary.unassignedExpenseTotal)}`" />
      <Tag severity="info" :value="`${visibleTransactions.length} Buchungen`" />
    </template>

    <template #toolbar>
      <div class="toolbar-month">
        <label for="expenses-month-select" class="toolbar-month__label">Monat</label>
        <Select
          id="expenses-month-select"
          :model-value="month"
          :options="monthOptions"
          option-label="label"
          option-value="value"
          :loading="txLoading"
          aria-label="Monat auswaehlen"
          @update:model-value="onMonthChange"
        />
      </div>
      <Button label="Ausgabe anlegen" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="txLoading"
      :no-household="!txLoading && !activeHousehold"
      loading-title="Ausgaben werden geladen"
    />

    <!-- First-Time / No-Data: ersetzt die leere Tabelle, wenn keine Buchungen
         in der Liste sind. Variante haengt vom Haushalt-Alter ab. -->
    <EmptyState
      v-if="!txLoading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-wallet"
      icon-tone="accent"
      headline="Noch keine Ausgaben"
      :description="`Lege deine erste Ausgabe fuer ${monthLabel} an, um Auswertungen zu sehen.`"
      :cta="{ label: 'Ausgabe anlegen', onClick: openCreateTransactionDialog, severity: 'primary' }"
    />
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0"
      variant="no-data"
      icon="pi pi-receipt"
      icon-tone="muted"
      :headline="`Keine Ausgaben in ${monthLabel}`"
      description="Wechsle den Monat im Spinner oben, oder erfasse eine neue Buchung."
    />

    <template v-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length > 0">
      <ListPanel
        kicker="Monat"
        :title="`Ausgaben ${monthLabel}`"
        compact
        :badge="formatMoney(summary.expenseTotal)"
      >
        <ListTable dense accent="primary">
          <template #head>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th>Budget</th>
            <th class="muted">Von</th>
            <th class="num">Betrag</th>
            <th class="actions"></th>
          </template>

          <tr v-for="transaction in visibleTransactions" :key="transaction.id">
            <template v-if="editingTransactionId === transaction.id">
              <td colspan="6" class="data-table__edit-cell">
                <TransactionRowEditor
                  :transaction="transaction"
                  :budget-options="budgetSelectOptions"
                  :currency="currencyCode"
                  :saving="actionLoadingKey === `expense:${transaction.id}`"
                  :error="inlineEditError"
                  @save="(payload) => saveInlineEdit(transaction.id, payload)"
                  @cancel="cancelInlineEdit"
                />
              </td>
            </template>
            <template v-else>
              <td class="muted">{{ formatDate(transaction.date) }}</td>
              <td class="name">
                {{ transaction.description || 'Ausgabe' }}
                <span v-if="isUnassigned(transaction)" class="sub">ohne Budgetzuordnung</span>
              </td>
              <td>
                <span :class="['budget-pill', isUnassigned(transaction) ? 'budget-pill--muted' : '']">
                  {{ budgetLabel(transaction) }}
                </span>
              </td>
              <td class="muted">{{ transaction.user.displayName || transaction.user.email }}</td>
              <td class="num">−{{ formatMoney(transaction.amount) }}</td>
              <td class="actions">
                <Button
                  icon="pi pi-pen-to-square"
                  severity="secondary"
                  outlined
                  size="small"
                  text
                  aria-label="Ausgabe inline bearbeiten"
                  :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                  @click="startInlineEdit(transaction.id)"
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  text
                  aria-label="Ausgabe löschen"
                  :loading="actionLoadingKey === `expense:${transaction.id}`"
                  :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                  @click="deleteTransaction(transaction)"
                />
              </td>
            </template>
          </tr>

          <tr v-if="visibleTransactions.length === 0">
            <td colspan="6" class="data-table__empty">Keine Ausgaben in {{ monthLabel }}.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle. Betrag prominent oben rechts. -->
          <template #mobile>
            <div v-if="visibleTransactions.length === 0" class="data-table__empty">
              Keine Ausgaben in {{ monthLabel }}.
            </div>
            <div
              v-for="transaction in visibleTransactions"
              v-else
              :key="`m-${transaction.id}`"
              :class="['data-table__card', { 'data-table__card--editing': editingTransactionId === transaction.id }]"
            >
              <template v-if="editingTransactionId === transaction.id">
                <TransactionRowEditor
                  :transaction="transaction"
                  :budget-options="budgetSelectOptions"
                  :currency="currencyCode"
                  :saving="actionLoadingKey === `expense:${transaction.id}`"
                  :error="inlineEditError"
                  @save="(payload) => saveInlineEdit(transaction.id, payload)"
                  @cancel="cancelInlineEdit"
                />
              </template>
              <template v-else>
                <div class="data-table__card-line">
                  <span class="data-table__card-name">
                    {{ transaction.description || 'Ausgabe' }}
                  </span>
                  <span class="data-table__card-amount" style="color: rgb(248, 113, 113);">
                    −{{ formatMoney(transaction.amount) }}
                  </span>
                </div>
                <div class="data-table__card-meta">
                  <span>{{ formatDate(transaction.date) }}</span>
                  <span>·</span>
                  <span :class="['budget-pill', isUnassigned(transaction) ? 'budget-pill--muted' : '']">
                    {{ budgetLabel(transaction) }}
                  </span>
                  <span>·</span>
                  <span>{{ transaction.user.displayName || transaction.user.email }}</span>
                </div>
                <div class="data-table__card-actions">
                  <Button
                    icon="pi pi-pen-to-square"
                    severity="secondary"
                    outlined
                    size="small"
                    text
                    aria-label="Ausgabe inline bearbeiten"
                    :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                    @click="startInlineEdit(transaction.id)"
                  />
                  <Button
                    icon="pi pi-trash"
                    severity="danger"
                    outlined
                    size="small"
                    text
                    aria-label="Ausgabe löschen"
                    :loading="actionLoadingKey === `expense:${transaction.id}`"
                    :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                    @click="deleteTransaction(transaction)"
                  />
                </div>
              </template>
            </div>
          </template>
        </ListTable>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="transactionDialogOpen"
      :header="editingTransactionId ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'"
      :submit-label="editingTransactionId ? 'Ausgabe aktualisieren' : 'Ausgabe anlegen'"
      :saving="transactionLoading"
      @save="saveTransaction"
      @cancel="closeTransactionDialog"
    >
      <FormFieldRow label="Betrag" html-for="transaction-amount">
        <InputNumber
          id="transaction-amount"
          v-model="transactionForm.amount"
          mode="currency"
          :currency="currencyCode"
          locale="de-DE"
          inputClass="w-full"
          :minFractionDigits="2"
          :maxFractionDigits="2"
          placeholder="0,00"
        />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="transaction-date">
        <DatePicker id="transaction-date" v-model="transactionForm.date" dateFormat="dd.mm.yy" showIcon inputClass="w-full" />
      </FormFieldRow>
      <FormFieldRow label="Beschreibung" html-for="transaction-description" wide>
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Einkauf bei Rewe" />
      </FormFieldRow>
      <FormFieldRow label="Budget" html-for="transaction-budget" wide>
        <Select id="transaction-budget" v-model="transactionForm.budgetId" :options="budgetSelectOptions" optionLabel="label" optionValue="value" />
      </FormFieldRow>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.budget-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: #93c5fd;
  font-size: 0.74rem;
  font-weight: 700;
  white-space: nowrap;
}

.budget-pill--muted {
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}

.toolbar-month {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}

.toolbar-month__label {
  font-size: 0.85rem;
  color: var(--text-muted, #94a3b8);
}

/* Issue #15: Inline-Edit-Cell (Desktop-Tabellen-Zeile) */
.data-table__edit-cell {
  padding: 0 !important;
  background: rgba(59, 130, 246, 0.04);
}

.data-table__card--editing {
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid #60a5fa;
  padding: 8px;
}

@media (max-width: 480px) {
  .toolbar-month {
    width: 100%;
  }
}
</style>
