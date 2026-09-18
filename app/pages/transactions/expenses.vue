<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Menu from 'primevue/menu'
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

// Der mobile FAB ueberlappt bei kurzen Listen die rechtsbuendigen
// Speichern/Abbrechen-Buttons des Inline-Editors (siehe useInlineEditing.ts).
// Waehrend eine Zeile bearbeitet wird, blenden wir ihn deshalb aus.
const inlineEditing = useInlineEditing()
watch(editingTransactionId, (next, prev) => {
  if (next !== null && prev === null) inlineEditing.start()
  else if (next === null && prev !== null) inlineEditing.stop()
})

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
// Vue's Template-Compiler sie auto-unwrapped. Ein `tx.summary` im
// Template wäre ein nested Ref auf einem zurückgegebenen Object und
// würde NICHT auto-unwrap — Consumer bekämen dann den Ref-Proxy.
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
  // Klick auf eine Dashboard-Budget-Karte verlinkt hierher mit
  // ?from=<periodStart>&to=<periodEnd> (ISO) statt ?month — die exakte
  // Budget-Periode passt bei WEEKLY/QUARTERLY/YEARLY/ONCE nicht auf
  // Kalendermonate. `to` fehlt bei einer offenen ONCE-Periode.
  initialFrom: typeof route.query.from === 'string' && route.query.from.length > 0 ? route.query.from : undefined,
  initialTo: typeof route.query.to === 'string' && route.query.to.length > 0 ? route.query.to : null,
})
const month = tx.month
const range = tx.range
const unassignedOnly = tx.unassignedOnly
const userIdFilter = tx.userIdFilter
const budgetIdFilter = tx.budgetIdFilter
const hasLocalFilters = tx.hasLocalFilters
const monthLabel = tx.monthLabel
const summary = tx.summary
const txLoading = tx.loading
const txError = tx.error
const setMonth = tx.setMonth
const setUnassignedOnly = tx.setUnassignedOnly
const setUserIdFilter = tx.setUserIdFilter
const setBudgetIdFilter = tx.setBudgetIdFilter
const setRange = tx.setRange
const clearRange = tx.clearRange
const clearLocalFilters = tx.clearLocalFilters
const loadTransactions = tx.load
const transactionsByKind = tx.transactionsByKind
const updateTransactionLocal = tx.updateTransactionLocal
const restoreTransactionLocal = tx.restoreTransactionLocal
const removeTransactionLocal = tx.removeTransactionLocal
const insertTransactionLocal = tx.insertTransactionLocal

const visibleTransactions = computed(() => transactionsByKind('expense'))

// === Zeitraum-Modus (Klick auf eine Dashboard-Budget-Karte) ==============
// `range` ersetzt den Monats-Modus, solange ?from(&to) in der URL steht.
// Statt des Monats-Switchers zeigt die Toolbar dann eine schlichte
// Zeitraum-Zeile mit Ausstiegs-Link — ein Monats-Stepper ergibt fuer eine
// beliebige Woche/Quartal/Jahr keinen Sinn.
const isRangeMode = computed(() => range.value !== null)
const rangeFormatter = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
const rangeLabel = computed(() => {
  if (!range.value) return null
  const start = new Date(range.value.from)
  if (!range.value.to) return `seit ${rangeFormatter.format(start)}`
  // `to` ist exklusiv (wie monthEnd) — fuer die Anzeige einen Tag abziehen,
  // sonst wuerde z. B. eine Woche als "14.–21. Sept" statt "14.–20. Sept"
  // angezeigt (der 21. gehoert schon zur naechsten Periode).
  const endDisplay = new Date(range.value.to)
  endDisplay.setDate(endDisplay.getDate() - 1)
  return `${rangeFormatter.format(start)} – ${rangeFormatter.format(endDisplay)}`
})
// Fuer Empty-State-Texte, die sonst "in {monthLabel}" sagen: im
// Zeitraum-Modus ist der Perioden-Zeitraum die richtige Angabe, nicht
// der (irrelevante) aktuelle Monat.
const periodOrMonthLabel = computed(() => rangeLabel.value ?? monthLabel.value)

// Verlaesst den Zeitraum-Modus: Filter zuruecksetzen, URL bereinigen,
// aktuellen Monat neu laden.
async function exitRangeMode() {
  clearRange()
  clearLocalFilters()
  await router.replace({ query: {} })
  await loadTransactions(activeHouseholdId.value)
}

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
 * - from/to: wenn ein Zeitraum aktiv ist (Klick auf eine Budget-Karte) —
 *   ersetzt month komplett, solange range gesetzt ist
 * - month: nur wenn nicht aktueller Monat (und kein Zeitraum aktiv)
 * - unassigned: nur wenn aktiv
 * - userId: nur wenn gesetzt
 * - budgetId: nur wenn gesetzt
 *
 * `monthOverride` ist ein Hack fuer `onMonthChange`: der neue Monat
 * ist noch nicht in `month.value` committed, wenn die Query gebaut
 * wird. Der Caller uebergibt ihn hier explizit, damit die Helper-
 * Funktion den State nicht selbst kennen muss. Nur relevant im
 * Monats-Modus — `onMonthChange` feuert nie waehrend isRangeMode
 * (der Monats-Stepper ist dann ausgeblendet).
 */
function buildRouteQuery(options: { monthOverride?: string } = {}): Record<string, string> {
  const query: Record<string, string> = {}
  if (range.value) {
    query.from = range.value.from
    if (range.value.to) query.to = range.value.to
  } else {
    const currentMonth = new Date().toISOString().slice(0, 7)
    const monthValue = options.monthOverride ?? month.value
    if (monthValue !== currentMonth) query.month = monthValue
  }
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

// Issue #55: Person-Filter aendern. Schreibt in den Composable-State, laedt
// neu (der Server filtert Liste UND Summary, issue #134 — die Badge oben
// muss zur gefilterten Liste passen) und synct die URL.
async function onUserIdFilterChange(value: string | null) {
  setUserIdFilter(value)
  await loadTransactions(activeHouseholdId.value)
  await router.replace({ query: buildRouteQuery() })
}

// Issue #55: Budget-Filter aendern. Gleiches Pattern wie Person-Filter.
async function onBudgetIdFilterChange(value: string | null) {
  setBudgetIdFilter(value)
  await loadTransactions(activeHouseholdId.value)
  await router.replace({ query: buildRouteQuery() })
}

// Issue #55: Beide Filter (Person + Budget) auf einmal leeren.
// Praktisch fuer "Alle anzeigen"-Buttons in der Empty-State.
async function clearAllLocalFilters() {
  clearLocalFilters()
  await loadTransactions(activeHouseholdId.value)
  await router.replace({ query: buildRouteQuery() })
}

// === Issue #95: Filter-Leiste ========================================
// Sekundaere Filter (Person / Budget / ohne Budget) leben hinter einem
// Toggle. Initial offen, wenn per Deep-Link schon ein Filter aktiv ist —
// AUSSER im Zeitraum-Modus (Klick auf eine Dashboard-Budget-Karte): der
// Kontext (Budget + Zeitraum) ist durch den Klick bereits vorgegeben, die
// Filter-Chips muessen nicht direkt sichtbar sein (Issue "Ausgabenliste
// deutlich kompakter gestalten").
const filtersOpen = ref(!isRangeMode.value && (unassignedOnly.value || hasLocalFilters.value))
const activeFilterCount = computed(
  () =>
    (userIdFilter.value ? 1 : 0) +
    (budgetIdFilter.value ? 1 : 0) +
    (unassignedOnly.value ? 1 : 0),
)

// Alle drei Filter auf einmal zuruecksetzen (Person + Budget + unassigned).
// Ein einziger Reload danach — der Server filtert alle drei (issue #134).
async function resetAllFilters() {
  clearLocalFilters()
  setUnassignedOnly(false)
  await loadTransactions(activeHouseholdId.value)
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

/**
 * Alle aktiven Filter (Zeitraum + Person + Budget + Ohne-Budget) als
 * Chip-Liste fuer die Toolbar — jeder Chip hat sein eigenes X, das genau
 * diesen einen Filter entfernt. Der Zeitraum-Chip ersetzt den frueheren
 * "Zur Monatsansicht"-Button: sein X ruft dieselbe `exitRangeMode`-Logik.
 */
type FilterChip = { key: string; label: string; icon: string; onRemove: () => void }
const activeFilterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = []
  if (isRangeMode.value && rangeLabel.value) {
    chips.push({ key: 'range', label: rangeLabel.value, icon: 'pi pi-calendar', onRemove: exitRangeMode })
  }
  if (userIdFilter.value) {
    const member = memberOptions.value.find((m) => m.id === userIdFilter.value)
    chips.push({
      key: 'user',
      label: member?.displayName || member?.email || 'Person',
      icon: 'pi pi-user',
      onRemove: () => onUserIdFilterChange(null),
    })
  }
  if (budgetIdFilter.value) {
    const budget = budgetOptions.value.find((b) => b.id === budgetIdFilter.value)
    chips.push({
      key: 'budget',
      label: budget?.name ?? 'Budget',
      icon: 'pi pi-wallet',
      onRemove: () => onBudgetIdFilterChange(null),
    })
  }
  if (unassignedOnly.value) {
    chips.push({ key: 'unassigned', label: 'Ohne Budget', icon: 'pi pi-filter', onRemove: toggleUnassignedFilter })
  }
  return chips
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
// State nachziehen UND neu geladen werden (issue #134: der Server filtert
// Liste + Summary). Die Change-Handler oben laden selbst, bevor sie die URL
// setzen — dann ist `next === userIdFilter.value` und hier passiert nichts
// (kein Doppel-Load).
watch(
  () => route.query.userId,
  async (newValue) => {
    const next = typeof newValue === 'string' && newValue.length > 0 ? newValue : null
    if (next !== userIdFilter.value) {
      setUserIdFilter(next)
      await loadTransactions(activeHouseholdId.value)
    }
  },
)
watch(
  () => route.query.budgetId,
  async (newValue) => {
    const next = typeof newValue === 'string' && newValue.length > 0 ? newValue : null
    if (next !== budgetIdFilter.value) {
      setBudgetIdFilter(next)
      await loadTransactions(activeHouseholdId.value)
    }
  },
)

// Zeitraum-Modus: gleicher Browser-Back/-Forward-Sync wie oben. Anders
// als die Local-Filter braucht ein Range-Wechsel einen echten Reload
// (der Server liefert die Liste fuer den Zeitraum, keine Client-Filterung).
watch(
  () => [route.query.from, route.query.to],
  async ([newFrom, newTo]) => {
    const nextFrom = typeof newFrom === 'string' && newFrom.length > 0 ? newFrom : null
    const nextTo = typeof newTo === 'string' && newTo.length > 0 ? newTo : null
    const currentFrom = range.value?.from ?? null
    const currentTo = range.value?.to ?? null
    if (nextFrom === currentFrom && nextTo === currentTo) return
    if (nextFrom) {
      await setRange(nextFrom, nextTo, activeHouseholdId.value)
    } else {
      clearRange()
      await loadTransactions(activeHouseholdId.value)
    }
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
    notice.value = { severity: 'success', text: 'Ausgabe wurde aktualisiert.' }
    // Summary (Badge) + Liste vom Server nachziehen (issue #134): nur er
    // kennt die zu den aktiven Filtern passende Summe, und eine Bearbeitung
    // kann die Zeile aus dem Filter (z. B. Budget) herausfallen lassen.
    // `silent`, damit die Liste nicht kurz durch den Lade-Zustand ersetzt wird.
    await loadTransactions(activeHouseholdId.value, { silent: true })
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
  // Nach Loeschen UND Wiederherstellen die Summary (Badge) vom Server
  // nachziehen (issue #134), im Hintergrund ohne Lade-Zustand.
  onAfterChange: () => { void loadTransactions(activeHouseholdId.value, { silent: true }) },
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
  if (editingTransactionId.value !== null) inlineEditing.stop()
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

// === Mobile-Kartenliste: Datum-Gruppierung + Floating Options-Menu ======
// Setzt voraus, dass `visibleTransactions` nach Datum sortiert ist (date
// DESC, siehe useTransactionList/insertTransactionLocal + Server-Sortierung
// in transactions.get.ts) — sonst wuerden gleiche Tage nicht zusammen-
// haengend gruppiert. Gruppen-Key ist das FORMATIERTE Datum (nicht der
// rohe ISO-String), damit die Gruppengrenze exakt dem entspricht, was
// angezeigt wird (kein Risiko einer Zeitzonen-Verschiebung durch simples
// String-Slicing).
const groupedByDate = computed(() => {
  const groups: { dateLabel: string; items: typeof visibleTransactions.value }[] = []
  for (const transaction of visibleTransactions.value) {
    const dateLabel = formatDate(transaction.date)
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.dateLabel === dateLabel) {
      lastGroup.items.push(transaction)
    } else {
      groups.push({ dateLabel, items: [transaction] })
    }
  }
  return groups
})

// Ein geteiltes PrimeVue-Menu statt permanent sichtbarer Bearbeiten/
// Loeschen-Icons pro Karte (Folge-Feedback zu "Ausgabenliste deutlich
// kompakter gestalten"). `cardMenuTransaction` haelt fest, fuer welche
// Karte das Menu gerade geoeffnet ist/wurde — die Menu-Items lesen das
// reaktiv, ohne dass jede Karte ihr eigenes Menu-Element braucht.
const cardMenu = ref<InstanceType<typeof Menu> | null>(null)
const cardMenuTransaction = ref<(typeof visibleTransactions.value)[number] | null>(null)

function openCardMenu(event: Event, transaction: (typeof visibleTransactions.value)[number]) {
  cardMenuTransaction.value = transaction
  cardMenu.value?.toggle(event)
}

const cardMenuItems = computed(() => {
  const transaction = cardMenuTransaction.value
  // Gleiche Sperre wie vorher auf den Icon-Buttons: waehrend eine ANDERE
  // Karte im Inline-Edit ist, sind Aktionen auf dieser Karte gesperrt.
  const disabled = !transaction || (editingTransactionId.value !== null && editingTransactionId.value !== transaction.id)
  return [
    {
      label: 'Bearbeiten',
      icon: 'pi pi-pen-to-square',
      disabled,
      command: () => { if (transaction) startInlineEdit(transaction.id) },
    },
    {
      label: 'Löschen',
      icon: 'pi pi-trash',
      disabled,
      command: () => { if (transaction) deleteTransaction(transaction) },
    },
  ]
})

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

// Issue #91: der globale Erfassen-Dialog kann von hier aus (oder von
// jeder anderen Seite) eine Ausgabe anlegen. savedTick steigt nach
// jedem erfolgreichen POST — dann die sichtbare Liste neu laden.
const { savedTick: quickCaptureSavedTick } = useQuickCapture()
watch(quickCaptureSavedTick, async () => { await loadAll() })
</script>

<template>
  <ListPageShell title="Ausgaben">
    <template #summary>
      <!-- Bei aktivem Person-/Budget-/Ohne-Budget-Filter ist das die Summe der
           gefilterten Liste, nicht des ganzen Zeitraums (issue #134). -->
      <Tag
        severity="warning"
        :value="`${activeFilterCount > 0 ? 'Ausgaben (gefiltert)' : 'Ausgaben'} ${formatMoney(summary.expenseTotal)}`"
      />
      <Tag
        v-if="summary.unassignedExpenseTotal > 0"
        severity="secondary"
        :value="`Ohne Budget ${formatMoney(summary.unassignedExpenseTotal)}`"
      />
    </template>

    <template #toolbar>
      <!-- Zeitraum-Modus (Klick auf eine Dashboard-Budget-Karte): ein
           Monats-Stepper ergibt fuer eine beliebige Woche/Quartal/Jahr
           keinen Sinn — der aktive Zeitraum steht stattdessen als
           entfernbarer Chip unten (siehe active-filter-chips). -->
      <div v-if="!isRangeMode" class="toolbar-month">
        <MonthSwitcher :model-value="month" :loading="txLoading" @update:model-value="onMonthChange" />
      </div>
      <!-- Issue #95: sekundaere Filter hinter einem Toggle — die Toolbar
           bleibt schlank, die Liste steht ueber dem Fold. -->
      <FilterDisclosure v-model:open="filtersOpen" :active-count="activeFilterCount" />
      <!-- Issue #92: Auf Mobile (< 640px) verdeckt der FAB Speed-Dial
           diesen Button und bietet dieselbe Aktion — hier ausblenden. -->
      <Button label="Ausgabe anlegen" icon="pi pi-plus" severity="success" class="toolbar-create-btn" @click="openCreateTransactionDialog" />
    </template>

    <!-- Alle aktiven Filter (Zeitraum/Person/Budget/Ohne-Budget) als
         entfernbare Chips — ersetzt den frueheren separaten "Zur
         Monatsansicht"-Button, dessen Funktion jetzt das X auf dem
         Zeitraum-Chip uebernimmt. -->
    <div v-if="activeFilterChips.length > 0" class="active-filter-chips" role="group" aria-label="Aktive Filter">
      <span v-for="chip in activeFilterChips" :key="chip.key" class="filter-chip">
        <i v-if="chip.icon" :class="chip.icon" aria-hidden="true" />
        {{ chip.label }}
        <button
          type="button"
          class="filter-chip__remove"
          :aria-label="`${chip.label} entfernen`"
          @click="chip.onRemove"
        >
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </span>
    </div>

    <!-- Issue #95: aufklappbare Filter-Leiste. Initial offen, wenn per
         Deep-Link (?userId / ?budgetId / ?unassigned) schon ein Filter
         aktiv ist. -->
    <div v-if="filtersOpen" class="filter-panel" role="group" aria-label="Filter">
      <!-- Issue #55: Person-Filter. Wert null = "Alle Mitglieder". -->
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
      <!-- Issue #55: Budget-Filter, "Alle Budgets" als Default. -->
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
      <!-- Issue #52: Toggle fuer den ?unassigned=1-Filter. -->
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
      <Button
        v-if="activeFilterCount > 0"
        label="Zuruecksetzen"
        icon="pi pi-times"
        severity="secondary"
        text
        size="small"
        @click="resetAllFilters"
      />
    </div>

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
      :description="`Lege deine erste Ausgabe fuer ${periodOrMonthLabel} an, um Auswertungen zu sehen.`"
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
      :headline="`Alle Ausgaben in ${periodOrMonthLabel} haben ein Budget`"
      :description="`In ${periodOrMonthLabel} ist keine Ausgabe ohne Budgetzuordnung offen. Du kannst den Filter ausschalten, um alle Buchungen zu sehen.`"
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
      :headline="`Keine Ausgaben fuer ${activeFilterLabel} in ${periodOrMonthLabel}`"
      :description="`Mit der aktuellen Filter-Auswahl gibt es in ${periodOrMonthLabel} keine Treffer. Du kannst die Filter zuruecksetzen, um alle Buchungen zu sehen.`"
      :cta="{ label: 'Alle Ausgaben anzeigen', onClick: clearAllLocalFilters, severity: 'secondary' }"
    />
    <EmptyState
      v-else-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length === 0"
      variant="no-data"
      icon="pi pi-receipt"
      icon-tone="muted"
      :headline="`Keine Ausgaben in ${periodOrMonthLabel}`"
      :description="isRangeMode ? 'Fuer diesen Zeitraum liegt keine Buchung vor.' : 'Wechsle den Monat im Spinner oben, oder erfasse eine neue Buchung.'"
    />

    <template v-if="!txLoading && activeHousehold && currentHousehold && visibleTransactions.length > 0">
      <!-- "Ausgaben ..." steht schon als Seiten-H1 + Zeitraum-Chip oben —
           kein eigener Panel-Titel/Badge mehr noetig (Issue "Ausgabenliste
           deutlich kompakter gestalten" + Folge-Feedback). -->
      <ListPanel compact>
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
            <td colspan="6" class="data-table__empty">Keine Ausgaben in {{ periodOrMonthLabel }}.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle, gruppiert nach Datum.
               Bearbeiten/Loeschen per Tap auf die Karte (Floating-Menu)
               oder per Swipe (rechts = Bearbeiten, links = Loeschen). -->
          <template #mobile>
            <div v-if="visibleTransactions.length === 0" class="data-table__empty">
              Keine Ausgaben in {{ periodOrMonthLabel }}.
            </div>
            <template v-for="group in groupedByDate" v-else :key="group.dateLabel">
              <div class="data-table__date-separator">{{ group.dateLabel }}</div>
              <div
                v-for="transaction in group.items"
                :key="`m-${transaction.id}`"
                :class="['data-table__card', { 'data-table__card--editing': editingTransactionId === transaction.id }]"
              >
                <TransactionRowEditor
                  v-if="editingTransactionId === transaction.id"
                  :transaction="transaction"
                  :budget-options="budgetSelectOptions"
                  :currency="currencyCode"
                  :saving="actionLoadingKey === `expense:${transaction.id}`"
                  :error="inlineEditError"
                  @save="(payload) => saveInlineEdit(transaction.id, payload)"
                  @cancel="cancelInlineEdit"
                />
                <SwipeableListItem
                  v-else
                  swipe-right-icon="pi pi-pen-to-square"
                  swipe-right-label="Bearbeiten"
                  swipe-left-icon="pi pi-trash"
                  swipe-left-label="Löschen"
                  @swipe-right="startInlineEdit(transaction.id)"
                  @swipe-left="deleteTransaction(transaction)"
                >
                <div
                  class="data-table__card-content"
                  role="button"
                  tabindex="0"
                  :aria-label="`Optionen fuer ${transaction.description || 'Ausgabe'} anzeigen`"
                  @click="openCardMenu($event, transaction)"
                  @keydown.enter="openCardMenu($event, transaction)"
                  @keydown.space.prevent="openCardMenu($event, transaction)"
                >
                  <div class="data-table__card-line">
                    <span class="data-table__card-name">
                      {{ transaction.description || 'Ausgabe' }}
                    </span>
                    <span class="data-table__card-amount expense-amount">
                      −{{ formatMoney(transaction.amount) }}
                    </span>
                  </div>
                  <div class="data-table__card-meta">
                    <span :class="['budget-pill', isUnassigned(transaction) ? 'budget-pill--muted' : '']">
                      {{ budgetLabel(transaction) }}
                    </span>
                    <span class="data-table__card-user">
                      {{ transaction.user.displayName || transaction.user.email }}
                      <i class="pi pi-ellipsis-v data-table__card-hint" aria-hidden="true" />
                    </span>
                  </div>
                </div>
                </SwipeableListItem>
              </div>
            </template>
          </template>
        </ListTable>
      </ListPanel>
    </template>

    <!-- Floating Options-Menu fuer die Mobile-Kartenliste: ein geteiltes
         Menu statt permanent sichtbarer Bearbeiten/Loeschen-Icons pro
         Karte, geoeffnet per Tap auf die Karte (PrimeVue positioniert es
         am Klickpunkt/Trigger-Element). Zusaetzlich per Swipe erreichbar
         (siehe SwipeableListItem oben: rechts = Bearbeiten, links = Loeschen). -->
    <Menu ref="cardMenu" :model="cardMenuItems" popup />

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
.expense-amount {
  color: var(--color-accent-danger-text);
}

.budget-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: var(--color-accent-primary-text);
  font-size: 0.74rem;
  font-weight: 700;
  white-space: nowrap;
}

.budget-pill--muted {
  background: rgba(148, 163, 184, 0.16);
  color: var(--color-text-muted);
}

.toolbar-month {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}

/* Aktive Filter (Zeitraum/Person/Budget/Ohne-Budget) als Chips mit
   eigenem X. Ersetzt die frühere .toolbar-range-Zeile samt separatem
   "Zur Monatsansicht"-Button. */
.active-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.4rem 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: var(--color-accent-primary-text);
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
}

.filter-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0;
}

.filter-chip__remove:hover {
  background: rgba(59, 130, 246, 0.24);
}

/* Issue #55: Filter-Selects. Kompakte Breite; min-width verhindert,
   dass PrimeVue die Selects auf Mobile zu schmal rendert. */
.toolbar-filter {
  min-width: 180px;
  max-width: 240px;
}

/* Issue #95: aufklappbare Filter-Leiste unter der Toolbar. */
.filter-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-panel-soft);
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
  .filter-panel {
    align-items: stretch;
    flex-direction: column;
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

/* Issue #92: Toolbar-"Ausgabe anlegen" auf Mobile ausblenden — der
   FAB Speed-Dial (< 640px) uebernimmt die Aktion und wuerde den
   Button sonst ueberlagern. Ab 640px (kein FAB) bleibt er sichtbar. */
@media (max-width: 639px) {
  .toolbar-create-btn {
    display: none;
  }
}
</style>
