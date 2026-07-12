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

// Issue #55: Mitgliederliste aus /api/households/current fuer die
// Person-Filter-Select. Der Endpoint liefert pro Mitglied die
// Membership-Zeile (id/role/createdAt) plus den verschachtelten
// User-Datensatz (id/email/displayName/oidcSubject). Wir mappen
// das auf eine flache Struktur mit user.id als Schluessel, weil
// die Transactions-API den User per user.id referenziert.
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
  // Issue #52: Dashboard "ohne Budgetzuordnung"-Link setzt ?unassigned=1
  // in der URL. Die Page liest das hier und übergibt es als initial-Filter
  // an die Composable, damit der Deep-Link ohne Roundtrip greift.
  initialUnassignedOnly: route.query.unassigned === '1',
  // Issue #55: Person- und Budget-Filter aus URL-Parametern uebernehmen.
  // Leere Strings werden vom Composable als null behandelt, damit die
  // Default-URL sauber bleibt (kein "?userId=" in der Adressleiste).
  initialUserIdFilter: typeof route.query.userId === 'string' && route.query.userId.length > 0 ? route.query.userId : null,
  initialBudgetIdFilter: typeof route.query.budgetId === 'string' && route.query.budgetId.length > 0 ? route.query.budgetId : null,
})
const month = tx.month
const unassignedOnly = tx.unassignedOnly
const userIdFilter = tx.userIdFilter
const budgetIdFilter = tx.budgetIdFilter
const hasLocalFilters = tx.hasLocalFilters
const monthOptions = tx.monthOptions
const monthLabel = tx.monthLabel
const summary = tx.summary
const txLoading = tx.loading
const txError = tx.error
const setMonth = tx.setMonth
const setUnassignedOnly = tx.setUnassignedOnly
const setUserIdFilter = tx.setUserIdFilter
const setBudgetIdFilter = tx.setBudgetIdFilter
const clearLocalFilters = tx.clearLocalFilters
const loadTransactions = tx.load
const transactionsByKind = tx.transactionsByKind
const updateTransactionLocal = tx.updateTransactionLocal
const restoreTransactionLocal = tx.restoreTransactionLocal
const removeTransactionLocal = tx.removeTransactionLocal
const insertTransactionLocal = tx.insertTransactionLocal
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

// Issue #55: Option-Listen fuer die Filter-Selects in der Toolbar.
// Bewusst getrennt von `budgetSelectOptions` (Dialog), weil:
//  - Filter-Select hat "Alle …" als Default-Option (value null)
//  - Dialog-Select hat "Sonstiges" (value '') als Default-Option
// value: null ist noetig, damit PrimeVue-Select sauber zwischen "kein
// Filter" und "Filter auf ID" unterscheiden kann.
const memberOptions = computed(() => currentHousehold.value?.members ?? [])
const userFilterOptions = computed(() => [
  { label: 'Alle Mitglieder', value: null as string | null },
  ...memberOptions.value.map((member) => ({
    label: member.displayName || member.email,
    value: member.id as string | null,
  })),
])
const budgetFilterOptions = computed(() => [
  { label: 'Alle Budgets', value: null as string | null },
  ...budgetOptions.value.map((budget) => ({
    label: budget.name,
    value: budget.id as string | null,
  })),
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
  // Issue #52: aktiven unassigned-Filter in der Query erhalten, damit der
  // Deep-Link ueber Browser-Back / -Forward bestehen bleibt.
  // Issue #55: zusaetzlich userId- und budgetId-Filter preserved, damit
  // ein Monats-Wechsel die anderen Filter nicht zuruecksetzt.
  const query = buildRouteQuery({ monthOverride: newMonth })
  await router.replace({ query })
}

/**
 * Baut den URL-Query aus dem aktuellen Filter-State. Wird von allen
 * Change-Handlern (onMonthChange, toggleUnassignedFilter,
 * onUserIdFilterChange, onBudgetIdFilterChange) gemeinsam genutzt,
 * damit die "Query-ist-sauber"-Regel an einer Stelle lebt.
 *
 * Default-URL-Konvention (issue #55 / #52): nur aktive Filter und
 * Non-Default-Werte landen im Query. So bleibt die Adressleiste
 * lesbar und Deep-Links zeigen nur die relevanten Abweichungen.
 *
 * - month: nur wenn nicht aktueller Monat
 * - unassigned: nur wenn aktiv
 * - userId: nur wenn gesetzt
 * - budgetId: nur wenn gesetzt
 *
 * `monthOverride` ist ein Hack fuer `onMonthChange`: der neue Monat
 * ist noch nicht in `month.value` committed, wenn die Query gebaut
 * wird. Der Caller uebergibt ihn hier explizit, damit die Helper-
 * Funktion den State nicht selbst kennen muss.
 */
function buildRouteQuery(options: { monthOverride?: string } = {}): Record<string, string> {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthValue = options.monthOverride ?? month.value
  const query: Record<string, string> = {}
  if (monthValue !== currentMonth) query.month = monthValue
  if (unassignedOnly.value) query.unassigned = '1'
  if (userIdFilter.value) query.userId = userIdFilter.value
  if (budgetIdFilter.value) query.budgetId = budgetIdFilter.value
  return query
}

// Issue #52: Unassigned-Filter togglen. Schreibt in den URL-Query und
// triggert ein Reload, damit der Server mit dem neuen ?unassigned=1-
// Param die gefilterte Liste liefert. URL-Param wird zur einzigen
// Source-of-Truth, damit Browser-Back / -Forward konsistent funktioniert.
async function toggleUnassignedFilter() {
  const next = !unassignedOnly.value
  setUnassignedOnly(next)
  await loadTransactions(activeHouseholdId.value)
  // Query aufbauen — month nur, wenn nicht Default. unassigned nur,
  // wenn aktiv. So bleibt die URL sauber (kein redundantes ?unassigned=0).
  const query = buildRouteQuery()
  await router.replace({ query })
}

// Issue #55: Person-Filter aendern. Schreibt in den lokalen Composable-
// State (kein Reload noetig, weil der Server bereits alle Items geliefert
// hat und der Filter nur die View zurechtschneidet) und synct die URL.
async function onUserIdFilterChange(value: string | null) {
  setUserIdFilter(value)
  await router.replace({ query: buildRouteQuery() })
}

// Issue #55: Budget-Filter aendern. Gleiches Pattern wie Person-Filter.
async function onBudgetIdFilterChange(value: string | null) {
  setBudgetIdFilter(value)
  await router.replace({ query: buildRouteQuery() })
}

// Issue #55: Beide Local-Filter (Person + Budget) auf einmal leeren.
// Praktisch fuer "Alle anzeigen"-Buttons in der Empty-State.
async function clearAllLocalFilters() {
  clearLocalFilters()
  await router.replace({ query: buildRouteQuery() })
}

/**
 * Issue #55: Menschen-lesbares Etikett der aktiven Filter-Kombination
 * fuer die Empty-State-Headline ("Keine Ausgaben fuer {X} in {Monat}").
 * Beispiele:
 *  - nur Person aktiv: "Jan"
 *  - nur Budget aktiv: "Rewe"
 *  - beide aktiv:      "Jan im Rewe"
 *  - keiner aktiv:     "" (Caller prueft hasLocalFilters)
 */
const activeFilterLabel = computed(() => {
  const parts: string[] = []
  if (userIdFilter.value) {
    const member = memberOptions.value.find((m) => m.id === userIdFilter.value)
    parts.push(member?.displayName || member?.email || 'diese Person')
  }
  if (budgetIdFilter.value) {
    const budget = budgetOptions.value.find((b) => b.id === budgetIdFilter.value)
    parts.push(budget ? `im ${budget.name}` : 'dieses Budget')
  }
  return parts.join(' ')
})

// Issue #52: reaktive Sync, wenn der User per Browser-Back / -Forward
// die URL aendert (z. B. von /transactions/expenses?unassigned=1 zurueck
// auf /transactions/expenses ohne Filter). Ohne diesen Watch wuerde die
// Page den Filter-State behalten, obwohl die URL ihn nicht mehr traegt.
watch(
  () => route.query.unassigned,
  async (newValue) => {
    const shouldBeUnassigned = newValue === '1'
    if (shouldBeUnassigned !== unassignedOnly.value) {
      setUnassignedOnly(shouldBeUnassigned)
      await loadTransactions(activeHouseholdId.value)
    }
  },
)

// Issue #55: gleicher Sync fuer die neuen Filter. Wenn die URL per
// Browser-Back / -Forward / externer Link geaendert wird, muss der
// Local-State nachziehen. KEIN load()-Call noetig, weil die
// Local-Filter keinen Server-Roundtrip ausloesen.
watch(
  () => route.query.userId,
  (newValue) => {
    const next = typeof newValue === 'string' && newValue.length > 0 ? newValue : null
    if (next !== userIdFilter.value) setUserIdFilter(next)
  },
)
watch(
  () => route.query.budgetId,
  (newValue) => {
    const next = typeof newValue === 'string' && newValue.length > 0 ? newValue : null
    if (next !== budgetIdFilter.value) setBudgetIdFilter(next)
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
  transactionForm.value = { amount: null, description: '', date: new Date(), budgetId: '' }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const closeTransactionDialog = () => { transactionDialogOpen.value = false; resetForm() }

// === FAB Quick-Add (issue #29) ====================================
// Wenn der FAB mit ?new=1 hierher navigiert, soll der Create-Dialog
// direkt im selben Tick öffnen, ohne weiteren Tap. useQueryTrigger
// räumt die URL danach auf und garantiert per consumed-Guard, dass
// Re-Render oder Browser-Back den Dialog nicht doppelt öffnet.
useQueryTrigger({
  queryKey: 'new',
  onTrigger: openCreateTransactionDialog,
})

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
  // Lokaler State ist in Cents (t.amount / 100 im Editor, *100 zurück hier).
  // PATCH-Body schickt den Euro-Wert — Server-Endpoint parseMoneyToCents
  // macht die *100-Konvertierung, sonst wuerde der Wert doppelt skaliert.
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
        amount: payload.amount,
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

// === Soft-Delete mit Undo (issue #58) =================================
// useUndoableDelete kapselt Optimistic-Remove, 5-Sekunden-Undo-Banner,
// und Server-Restore. Pattern-Detail: removeTransactionLocal/insert
// kommen aus useTransactionList, weil der Composable die Listen-Source
// verwaltet (inkl. Sort). useUndoableDelete ist generisch und kennt
// nur die beiden Lambdas.
const undoableDelete = useUndoableDelete<{ id: string; description?: string | null; [key: string]: unknown }>({
  householdId: () => activeHouseholdId.value,
  kind: 'expense',
  onRemoveLocal: (id) => {
    removeTransactionLocal(id)
  },
  onRestoreLocal: (item) => {
    insertTransactionLocal(item as never)
  },
  onAfterChange: () => recomputeSummaryFromLocal(),
})

// pending + undo + dismiss aus dem Composable ziehen, damit das
// <UndoSnackbar />-Template sie nutzen kann. pending ist eine
// Map<id, PendingUndo>, latestPending ist der einzige (oder neueste)
// Eintrag. Bei mehreren parallelen Deletes wuerden wir hier den
// neuesten zeigen — fuer jetzt reicht der erste.
const undoPending = undoableDelete.pending
const undoLatest = computed(() => {
  const entries = Array.from(undoPending.value.values())
  return entries[entries.length - 1] ?? null
})

// Countdown-Anzeige: tickt jede Sekunde, damit der User sieht, wieviel
// Zeit er noch hat. Wird im Template an <UndoSnackbar :remaining-seconds>
// gebunden. Im Test (Vitest ohne echte Timer) ist das ein no-op, weil
// der Tick nur bei import.meta.client laeuft.
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

// Wenn ein neuer pending-Eintrag dazukommt, Tick starten. Wenn der
// letzte pending-Eintrag verschwindet (Undo oder Auto-Dismiss), Tick
// stoppen.
watch(
  () => undoPending.value.size,
  (size, prevSize) => {
    if (size > 0 && prevSize === 0) startUndoTick()
    if (size === 0) stopUndoTick()
  },
)

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('keydown', onEscapeKey)
  }
  stopUndoTick()
})

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
  // Loading-State bleibt auf dem Trash-Button, bis der DELETE-Call
  // durch ist. Danach verschwindet der Button mit der Zeile (Optimistic
  // Remove), Loading-State ist irrelevant.
  actionLoadingKey.value = `expense:${transaction.id}`
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
      <!-- Issue #55: Person-Filter (Single-Select). Wert null bedeutet
           "Alle Mitglieder" — PrimeVue-Select verträgt das ohne Custom-
           Placeholder, wenn die erste Option den Wert null hat. -->
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
      <!-- Issue #55: Budget-Filter (Single-Select). Gleiches Pattern
           wie Person-Filter, mit "Alle Budgets" als Default. -->
      <Select
        :model-value="budgetIdFilter"
        :options="budgetFilterOptions"
        option-label="label"
        option-value="value"
        placeholder="Alle Budgets"
        :loading="txLoading"
        aria-label="Buchungen nach Budget filtern"
        class="toolbar-filter"
        @update:model-value="onBudgetIdFilterChange"
      />
      <!-- Issue #52: Toggle-Button fuer den ?unassigned=1-Filter.
           Severity wechselt zwischen secondary (inaktiv) und warn (aktiv),
           damit der User auf einen Blick sieht, dass gefiltert wird. -->
      <Button
        :label="unassignedOnly ? 'Alle anzeigen' : 'Nur ohne Budget'"
        :icon="unassignedOnly ? 'pi pi-times' : 'pi pi-filter'"
        :severity="unassignedOnly ? 'warn' : 'secondary'"
        :outlined="!unassignedOnly"
        size="small"
        :aria-pressed="unassignedOnly"
        aria-label="Nach Buchungen ohne Budgetzuordnung filtern"
        @click="toggleUnassignedFilter"
      />
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
    <!-- Issue #52: Empty-State fuer den unassigned-Filter. Wenn aktiv
         und keine Treffer, ist die Aussage "kein Eintrag ohne Budget"
         informativer als das generische "Keine Ausgaben in <Monat>". -->
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0 && unassignedOnly"
      variant="no-data"
      icon="pi pi-check-circle"
      icon-tone="success"
      :headline="`Alle Ausgaben in ${monthLabel} haben ein Budget`"
      :description="`In ${monthLabel} ist keine Ausgabe ohne Budgetzuordnung offen. Du kannst den Filter ausschalten, um alle Buchungen zu sehen.`"
      :cta="{ label: 'Alle Ausgaben anzeigen', onClick: toggleUnassignedFilter, severity: 'secondary' }"
    />
    <!-- Issue #55: Empty-State fuer die Person/Budget-Filter. Wenn aktiv
         und keine Treffer, ist "Keine Ausgaben für [Filter-Kombi] in
         [Monat]" informativer als "Keine Ausgaben in <Monat>". CTA
         setzt die Local-Filter zurueck, der Unassigned-Filter bleibt
         unberuehrt (das ist semantisch ein separater Filter). -->
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0 && hasLocalFilters"
      variant="no-results"
      icon="pi pi-search"
      icon-tone="muted"
      :headline="`Keine Ausgaben fuer ${activeFilterLabel} in ${monthLabel}`"
      :description="`Mit der aktuellen Filter-Auswahl gibt es in ${monthLabel} keine Treffer. Du kannst die Filter zuruecksetzen, um alle Buchungen zu sehen.`"
      :cta="{ label: 'Alle Ausgaben anzeigen', onClick: clearAllLocalFilters, severity: 'secondary' }"
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
      <FormFieldRow label="Budget" html-for="transaction-budget" wide>
        <Select
          id="transaction-budget"
          v-model="transactionForm.budgetId"
          :options="budgetSelectOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Budget wählen"
        />
      </FormFieldRow>
      <FormFieldRow label="Beschreibung" html-for="transaction-description" wide>
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Einkauf bei Rewe" />
      </FormFieldRow>
      <!-- Datum (issue #32): visuell sekundaer, weil im Default-Flow
           immer "heute" — der User aendert es nur, wenn die Buchung
           nicht am aktuellen Tag stattfand. Reihenfolge folgt der
           Capture-Prioritaet: Betrag > Budget > Kontext > Datum. -->
      <FormFieldRow label="Datum" html-for="transaction-date" subtle>
        <DatePicker id="transaction-date" v-model="transactionForm.date" dateFormat="dd.mm.yy" showIcon inputClass="w-full" />
        <small class="form-field-helper">{{ todayDateHelperText }}</small>
      </FormFieldRow>
    </FormDialog>

    <!-- Undo-Snackbar (issue #58): erscheint nach Soft-Delete am unteren
         Bildschirmrand, bietet "Rueckgaengig"-Button. Verschwindet nach
         5 Sek. oder bei Undo / manuellem Dismiss. -->
    <UndoSnackbar
      v-if="undoItem"
      :item-id="undoItem.id"
      kind-label="Ausgabe"
      :item-description="undoItem.description"
      :remaining-seconds="undoRemaining"
      @undo="undoableDelete.undo"
      @dismiss="undoableDelete.dismiss"
    />
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

/* Issue #55: Filter-Selects in der Toolbar. Kompakte Hoehe, passt
   zu den Buttons daneben. min-width verhindert, dass PrimeVue
   die Selects auf Mobile zu schmal rendert. */
.toolbar-filter {
  min-width: 180px;
  max-width: 240px;
}

@media (max-width: 480px) {
  .toolbar-month {
    width: 100%;
  }
  /* Auf Mobile volle Breite, damit die Filter-Selects umbrechen
     koennen statt horizontal gequetscht zu werden. */
  .toolbar-filter {
    min-width: 0;
    width: 100%;
  }
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
</style>
