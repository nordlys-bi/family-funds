<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isFirstRun } from '~/utils/household-age'
import { todayDateHelperText } from '~/utils/form-helpers'

definePageMeta({ layout: 'default' })

type BudgetItem = {
  id: string
  key: string
  name: string
}

// Issue #55: Mitgliederliste fuer die Person-Filter-Select.
// Server liefert { id, role, user: { id, email, displayName } },
// wir flachen das auf { id, email, displayName }.
type MemberItem = {
  id: string
  displayName: string | null
  email: string
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
  members: MemberItem[]
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
  // Issue #55: Person-Filter fuer Income-Listen (Budget-Filter nicht
  // relevant, weil Einnahmen kein Budget haben — wird nicht angeboten).
  initialUserIdFilter: typeof route.query.userId === 'string' && route.query.userId.length > 0 ? route.query.userId : null,
})
const month = tx.month
const userIdFilter = tx.userIdFilter
const hasLocalFilters = tx.hasLocalFilters
const monthOptions = tx.monthOptions
const monthLabel = tx.monthLabel
const summary = tx.summary
const txLoading = tx.loading
const txError = tx.error
const setMonth = tx.setMonth
const setUserIdFilter = tx.setUserIdFilter
const clearLocalFilters = tx.clearLocalFilters
const loadTransactions = tx.load
const transactionsByKind = tx.transactionsByKind
const updateTransactionLocal = tx.updateTransactionLocal
const restoreTransactionLocal = tx.restoreTransactionLocal
const removeTransactionLocal = tx.removeTransactionLocal
const insertTransactionLocal = tx.insertTransactionLocal
const recomputeSummaryFromLocal = tx.recomputeSummaryFromLocal

const visibleTransactions = computed(() => transactionsByKind('income'))

// Empty-State-Variante (issue #13): First-Time für neue Haushalte, No-Data
// sonst. CTA "Einnahme anlegen" nur bei first-time, sonst nur Hinweis.
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const showFirstTimeEmpty = computed(
  () => visibleTransactions.value.length === 0 && isFirstRunHousehold.value,
)

const transactionForm = ref({
  amount: null as number | null,
  description: '',
  date: new Date(),
})

// Issue #55: Option-Liste fuer die Person-Filter-Select.
// value: null = "Alle Mitglieder" (kein Filter).
const memberOptions = computed(() => currentHousehold.value?.members ?? [])
const userFilterOptions = computed(() => [
  { label: 'Alle Mitglieder', value: null as string | null },
  ...memberOptions.value.map((member) => ({
    label: member.displayName || member.email,
    value: member.id as string | null,
  })),
])

// Month-Spinner-Change → URL-Sync + Reload (kein Full-Page-Reload)
async function onMonthChange(newMonth: string) {
  await setMonth(newMonth, activeHouseholdId.value)
  // query.month == aktueller Monat → Query loeschen, damit die Default-URL
  // sauber bleibt (kein "?month=2026-07" im Juli, wenn Juli der Default ist).
  // Issue #55: aktiven userId-Filter in der Query erhalten, damit ein
  // Monats-Wechsel die anderen Filter nicht zuruecksetzt.
  const query = buildRouteQuery({ monthOverride: newMonth })
  await router.replace({ query })
}

/**
 * Baut den URL-Query aus dem aktuellen Filter-State (issue #55).
 * Wird von allen Change-Handlern gemeinsam genutzt, damit die
 * "Query-ist-sauber"-Regel an einer Stelle lebt.
 *
 * Default-URL-Konvention: nur aktive Filter und Non-Default-Werte
 * landen im Query. So bleibt die Adressleiste lesbar.
 *  - month: nur wenn nicht aktueller Monat
 *  - userId: nur wenn gesetzt
 */
function buildRouteQuery(options: { monthOverride?: string } = {}): Record<string, string> {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthValue = options.monthOverride ?? month.value
  const query: Record<string, string> = {}
  if (monthValue !== currentMonth) query.month = monthValue
  if (userIdFilter.value) query.userId = userIdFilter.value
  return query
}

// Issue #55: Person-Filter aendern. Schreibt in den lokalen Composable-
// State (kein Reload noetig, weil der Server bereits alle Items geliefert
// hat und der Filter nur die View zurechtschneidet) und synct die URL.
async function onUserIdFilterChange(value: string | null) {
  setUserIdFilter(value)
  await router.replace({ query: buildRouteQuery() })
}

// Issue #55: Person-Filter auf einmal leeren. Praktisch fuer "Alle
// anzeigen"-Buttons in der Empty-State.
async function clearAllLocalFilters() {
  clearLocalFilters()
  await router.replace({ query: buildRouteQuery() })
}

/**
 * Issue #55: Menschen-lesbares Etikett des aktiven Filters fuer die
 * Empty-State-Headline ("Keine Einnahmen fuer {X} in {Monat}").
 * Aktuell ist nur der Person-Filter aktiv; gibt "" wenn nichts
 * gesetzt ist (Caller prueft hasLocalFilters).
 */
const activeFilterLabel = computed(() => {
  if (!userIdFilter.value) return ''
  const member = memberOptions.value.find((m) => m.id === userIdFilter.value)
  return member?.displayName || member?.email || 'diese Person'
})

// Issue #55: reaktive Sync, wenn der User per Browser-Back / -Forward
// die URL aendert. KEIN load()-Call noetig, weil die Local-Filter
// keinen Server-Roundtrip ausloesen.
watch(
  () => route.query.userId,
  (newValue) => {
    const next = typeof newValue === 'string' && newValue.length > 0 ? newValue : null
    if (next !== userIdFilter.value) setUserIdFilter(next)
  },
)

// --- Daten laden ---
async function loadCurrentHousehold() {
  try {
    // Server liefert pro Mitglied { id, role, user: { id, email, ... } }.
    // Wir flachen das auf { id, email, displayName } fuer die Select-Options.
    const current = await $fetch<{ household: (Omit<PlanningHousehold, 'members'> & { members: Array<{ id: string; user: { id: string; email: string; displayName: string | null } }> }) | null }>('/api/households/current')
    if (!current.household) {
      currentHousehold.value = null
      return
    }
    currentHousehold.value = {
      ...current.household,
      members: current.household.members.map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        displayName: membership.user.displayName,
      })),
    }
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
  transactionForm.value = { amount: null, description: '', date: new Date() }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const closeTransactionDialog = () => { transactionDialogOpen.value = false; resetForm() }

// === FAB Quick-Add (issue #29) ====================================
// Pattern identisch zu expenses.vue: ?new=1 öffnet den Dialog direkt
// beim Mount, URL wird danach aufgeraeumt. consumed-Guard verhindert
// Doppel-Oeffnen bei Re-Render oder Browser-Back.
useQueryTrigger({
  queryKey: 'new',
  onTrigger: openCreateTransactionDialog,
})

// === Inline-Edit (issue #15) ==========================================
// Single-Edit-Pattern: editingTransactionId haelt die ID der Zeile im
// Edit-Modus. Setzen einer neuen ID wechselt den Fokus automatisch.
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
  actionLoadingKey.value = `income:${transactionId}`

  // Optimistic Update via Composable-Helper (issue #15).
  // Lokaler State ist in Cents (t.amount / 100 im Editor, *100 zurück hier).
  // PATCH-Body schickt den Euro-Wert — Server-Endpoint parseMoneyToCents
  // macht die *100-Konvertierung, sonst wuerde der Wert doppelt skaliert.
  const amountCents = Math.round((payload.amount ?? 0) * 100)
  const original = updateTransactionLocal(transactionId, {
    amount: amountCents,
    description: payload.description,
    date: payload.date,
  })
  if (!original) {
    actionLoadingKey.value = null
    return
  }

  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'PATCH',
      body: {
        kind: 'income',
        id: transactionId,
        amount: payload.amount,
        description: payload.description,
        date: payload.date,
      },
    })
    editingTransactionId.value = null
    recomputeSummaryFromLocal()
    notice.value = { severity: 'success', text: 'Einnahme wurde aktualisiert.' }
  } catch (error: any) {
    // Rollback auf den Original-Wert (issue #15 Acceptance Criteria).
    restoreTransactionLocal(transactionId, original)
    inlineEditError.value = error?.statusMessage || error?.message || 'Speichern fehlgeschlagen.'
  } finally {
    actionLoadingKey.value = null
  }
}

// ESC bricht Inline-Edit ab (issue #15 Acceptance Criteria).
function onEscapeKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && editingTransactionId.value) {
    event.preventDefault()
    cancelInlineEdit()
  }
}

const saveTransaction = async () => {
  if (!activeHouseholdId.value) return
  transactionLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(editingTransactionId.value)
    const payload = {
      kind: 'income' as const,
      ...(editingTransactionId.value ? { id: editingTransactionId.value } : {}),
      amount: transactionForm.value.amount ?? undefined,
      description: transactionForm.value.description,
      date: transactionForm.value.date ? formatDateInput(transactionForm.value.date) : undefined,
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: editingTransactionId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadAll()
    closeTransactionDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Einnahme wurde aktualisiert.' : 'Einnahme wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahme konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    transactionLoading.value = false
  }
}

// === Soft-Delete mit Undo (issue #58) =================================
// Siehe expenses.vue — gleiches Pattern. useUndoableDelete kapselt den
// Flow, useTransactionList liefert die Listen-Helfer.
const undoableDelete = useUndoableDelete<{ id: string; description?: string | null; [key: string]: unknown }>({
  householdId: () => activeHouseholdId.value,
  kind: 'income',
  onRemoveLocal: (id) => {
    removeTransactionLocal(id)
  },
  onRestoreLocal: (item) => {
    insertTransactionLocal(item as never)
  },
  onAfterChange: () => recomputeSummaryFromLocal(),
})

// pending + undo + dismiss aus dem Composable, damit der <UndoSnackbar />
// sie nutzen kann. latest ist der einzige / neueste Eintrag, so wie in
// expenses.vue. Siehe dort fuer ausfuehrliche Kommentare.
const undoPending = undoableDelete.pending
const undoLatest = computed(() => {
  const entries = Array.from(undoPending.value.values())
  return entries[entries.length - 1] ?? null
})

const undoRemaining = ref(0)
let undoTickInterval: ReturnType<typeof setInterval> | null = null

function startUndoTick() {
  if (!import.meta.client) return
  if (undoTickInterval) return
  undoRemaining.value = 5
  undoTickInterval = setInterval(() => {
    if (undoRemaining.value > 0) undoRemaining.value -= 1
  }, 1000)
}

function stopUndoTick() {
  if (undoTickInterval) {
    clearInterval(undoTickInterval)
    undoTickInterval = null
  }
  undoRemaining.value = 0
}

watch(
  () => undoPending.value.size,
  (size, prevSize) => {
    if (size > 0 && prevSize === 0) startUndoTick()
    if (size === 0) stopUndoTick()
  },
)

const undoItem = computed(() => {
  const entry = undoLatest.value
  if (!entry) return null
  return {
    id: entry.item.id,
    description: (entry.item as { description?: string | null }).description ?? null,
  }
})

const deleteTransaction = async (transaction: { id: string; description?: string | null; [key: string]: unknown }) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `income:${transaction.id}`
  try {
    await undoableDelete.deleteWithUndo(transaction as never)
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
  stopUndoTick()
})
watch(activeHouseholdId, async () => { await loadAll() })
</script>

<template>
  <ListPageShell
    title="Einnahmen"
    :description="`Erfasse alle Einnahmen fuer ${monthLabel} — Gehalt, Boni, Rueckerstattungen, Geschenke.`"
  >
    <template #summary>
      <Tag severity="success" :value="`Einnahmen ${formatMoney(summary.incomeTotal)}`" />
      <Tag severity="info" :value="`${visibleTransactions.length} Buchungen`" />
    </template>

    <template #toolbar>
      <div class="toolbar-month">
        <label for="income-month-select" class="toolbar-month__label">Monat</label>
        <Select
          id="income-month-select"
          :model-value="month"
          :options="monthOptions"
          option-label="label"
          option-value="value"
          :loading="txLoading"
          aria-label="Monat auswaehlen"
          @update:model-value="onMonthChange"
        />
      </div>
      <!-- Issue #55: Person-Filter (Single-Select). Budget-Filter ist
           fuer Einnahmen nicht relevant, weil Income-Transaktionen kein
           Budget haben. -->
      <Select
        :model-value="userIdFilter"
        :options="userFilterOptions"
        option-label="label"
        option-value="value"
        placeholder="Alle Mitglieder"
        :loading="txLoading"
        aria-label="Buchungen nach Person filtern"
        class="toolbar-filter"
        @update:model-value="onUserIdFilterChange"
      />
      <Button label="Einnahme anlegen" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="txLoading"
      :no-household="!txLoading && !activeHousehold"
      loading-title="Einnahmen werden geladen"
    />

    <!-- First-Time / No-State: ersetzt leere Tabelle, wenn keine Einnahmen
         in der Liste sind. Variante haengt vom Haushalt-Alter ab. -->
    <EmptyState
      v-if="!txLoading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-arrow-up-right"
      icon-tone="success"
      headline="Noch keine Einnahmen"
      :description="`Erfasse deine erste Einnahme fuer ${monthLabel} — Gehalt, Bonus, Rueckerstattung.`"
      :cta="{ label: 'Einnahme anlegen', onClick: openCreateTransactionDialog, severity: 'success' }"
    />
    <!-- Issue #55: Empty-State fuer den Person-Filter. Wenn aktiv
         und keine Treffer, ist "Keine Einnahmen fuer {X} in {Monat}"
         informativer als das generische "Keine Einnahmen in <Monat>". -->
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0 && hasLocalFilters"
      variant="no-results"
      icon="pi pi-search"
      icon-tone="muted"
      :headline="`Keine Einnahmen fuer ${activeFilterLabel} in ${monthLabel}`"
      :description="`Mit der aktuellen Filter-Auswahl gibt es in ${monthLabel} keine Treffer. Du kannst den Filter zuruecksetzen, um alle Buchungen zu sehen.`"
      :cta="{ label: 'Alle Einnahmen anzeigen', onClick: clearAllLocalFilters, severity: 'secondary' }"
    />
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0"
      variant="no-data"
      icon="pi pi-receipt"
      icon-tone="muted"
      :headline="`Keine Einnahmen in ${monthLabel}`"
      description="Wechsle den Monat im Spinner oben, oder erfasse eine neue Einnahme."
    />

    <template v-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length > 0">
      <ListPanel
        kicker="Monat"
        :title="`Einnahmen ${monthLabel}`"
        compact
        :badge="formatMoney(summary.incomeTotal)"
      >
        <ListTable dense accent="primary">
          <template #head>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th class="muted">Von</th>
            <th class="num">Betrag</th>
            <th class="actions"></th>
          </template>

          <tr v-for="transaction in visibleTransactions" :key="transaction.id">
            <template v-if="editingTransactionId === transaction.id">
              <td colspan="5" class="data-table__edit-cell">
                <TransactionRowEditor
                  :transaction="transaction"
                  :currency="currencyCode"
                  :saving="actionLoadingKey === `income:${transaction.id}`"
                  :error="inlineEditError"
                  @save="(payload) => saveInlineEdit(transaction.id, payload)"
                  @cancel="cancelInlineEdit"
                />
              </td>
            </template>
            <template v-else>
              <td class="muted">{{ formatDate(transaction.date) }}</td>
              <td class="name">{{ transaction.description || 'Einnahme' }}</td>
              <td class="muted">{{ transaction.user.displayName || transaction.user.email }}</td>
              <td class="num income-amount">+{{ formatMoney(transaction.amount) }}</td>
              <td class="actions">
                <Button
                  icon="pi pi-pen-to-square"
                  severity="secondary"
                  outlined
                  size="small"
                  text
                  aria-label="Einnahme inline bearbeiten"
                  :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                  @click="startInlineEdit(transaction.id)"
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  text
                  aria-label="Einnahme löschen"
                  :loading="actionLoadingKey === `income:${transaction.id}`"
                  :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                  @click="deleteTransaction(transaction)"
                />
              </td>
            </template>
          </tr>

          <tr v-if="visibleTransactions.length === 0">
            <td colspan="5" class="data-table__empty">Keine Einnahmen in {{ monthLabel }}.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle. -->
          <template #mobile>
            <div v-if="visibleTransactions.length === 0" class="data-table__empty">
              Keine Einnahmen in {{ monthLabel }}.
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
                  :currency="currencyCode"
                  :saving="actionLoadingKey === `income:${transaction.id}`"
                  :error="inlineEditError"
                  @save="(payload) => saveInlineEdit(transaction.id, payload)"
                  @cancel="cancelInlineEdit"
                />
              </template>
              <template v-else>
                <div class="data-table__card-line">
                  <span class="data-table__card-name">
                    {{ transaction.description || 'Einnahme' }}
                  </span>
                  <span class="data-table__card-amount income-amount">
                    +{{ formatMoney(transaction.amount) }}
                  </span>
                </div>
                <div class="data-table__card-meta">
                  <span>{{ formatDate(transaction.date) }}</span>
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
                    aria-label="Einnahme inline bearbeiten"
                    :disabled="editingTransactionId !== null && editingTransactionId !== transaction.id"
                    @click="startInlineEdit(transaction.id)"
                  />
                  <Button
                    icon="pi pi-trash"
                    severity="danger"
                    outlined
                    size="small"
                    text
                    aria-label="Einnahme löschen"
                    :loading="actionLoadingKey === `income:${transaction.id}`"
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
      :header="editingTransactionId ? 'Einnahme bearbeiten' : 'Neue Einnahme'"
      :submit-label="editingTransactionId ? 'Einnahme aktualisieren' : 'Einnahme anlegen'"
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
        <small class="form-field-helper">{{ todayDateHelperText }}</small>
      </FormFieldRow>
      <FormFieldRow label="Beschreibung" html-for="transaction-description" wide>
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Gehalt September" />
      </FormFieldRow>
    </FormDialog>

    <!-- Undo-Snackbar (issue #58): siehe expenses.vue fuer Details. -->
    <UndoSnackbar
      v-if="undoItem"
      :item-id="undoItem.id"
      kind-label="Einnahme"
      :item-description="undoItem.description"
      :remaining-seconds="undoRemaining"
      @undo="undoableDelete.undo"
      @dismiss="undoableDelete.dismiss"
    />
  </ListPageShell>
</template>

<style scoped>
.income-amount {
  color: #34d399;
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

/* Issue #55: Filter-Select in der Toolbar. Kompakte Breite, passt
   zu den Buttons daneben. min-width verhindert, dass PrimeVue die
   Select auf Mobile zu schmal rendert. */
.toolbar-filter {
  min-width: 180px;
  max-width: 240px;
}

@media (max-width: 480px) {
  .toolbar-month {
    width: 100%;
  }
  /* Auf Mobile volle Breite, damit die Filter-Select umbrechen kann
     statt horizontal gequetscht zu werden. */
  .toolbar-filter {
    min-width: 0;
    width: 100%;
  }
}
</style>
