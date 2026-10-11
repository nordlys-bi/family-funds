<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Frequency, Notice } from '~/types/planning'

definePageMeta({ layout: 'default' })

type BudgetVersion = {
  id: string
  amount: number
  frequency: Frequency
  validFrom: string
}

type BudgetItem = {
  id: string
  key: string
  name: string
  // ADR-0004: Frequenz fest am Budget, Saldo als virtuelles Konto.
  frequency: Frequency
  closedAt: string | null
  carryoverToBudgetId: string | null
  balance: number
  versions: BudgetVersion[]
}

type BudgetOverviewItem = {
  budgetId: string
  key: string
  name: string
  currentAmount: number | null
  currentFrequency: Frequency | null
  currentValidFrom: string | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  periodCount: number
  versionCount: number
  // Naechste Betrags-Aenderung innerhalb des Monats (nach der angezeigten Version).
  nextChange: { validFrom: string; amount: number; frequency: Frequency } | null
  // Issue #82: Wochen-Detail, nur fuer WEEKLY-Budgets befuellt.
  // Wire-Format: start/end sind ISO-Strings (JSON-Date-Serialisierung).
  periods: Array<{
    start: string
    end: string
    plannedAmount: number
    spentAmount: number
    remainingAmount: number
    percentUsed: number
    severity: 'ok' | 'warning' | 'over'
  }>
}

type BudgetOverview = {
  plannedTotal: number
  spentTotal: number
  remainingTotal: number
  unassignedSpent: number
  budgets: BudgetOverviewItem[]
  unassigned: { name: string; spentAmount: number; remainingAmount: number }
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
  savingsGoals: Array<{ id: string; name: string }>
}

import { isFirstRun } from '~/utils/household-age'
import { currentMonthYYYYMM, isValidMonthYYYYMM, formatMonthLabel, parseMonthRange } from '~/utils/month-filter'

const { activeHousehold, canManageHousehold, fetchHouseholds } = useHousehold()
// Swipe (rechts = bearbeiten, links = loeschen) nur mobil und nur fuer Owner (issue #132).
const { swipeDisabled } = useListSwipe()
const confirm = useAskConfirm()
const route = useRoute()
const router = useRouter()

const currentHousehold = ref<PlanningHousehold | null>(null)
const budgetOverview = ref<BudgetOverview | null>(null)
// SSR-Initial-Render-Fix: `loading` startet auf `true`, damit EmptyState
// beim ersten Render den Spinner zeigt, BEVOR `loadHousehold` in onMounted
// die Daten geladen hat. Vorher startete `loading` auf `false`, was im
// SSR zu einem leeren EmptyState-Render fuehrte (keine loading/noHousehold/
// variant/slot-Bedingung griff → leere Kommentare), und der User sah
// eine leere Page bis zur Client-Hydration.
const loading = ref(true)
const notice = ref<Notice | null>(null)
const budgetLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const budgetDialogOpen = ref(false)

// === Month-Filter (issue #34) =========================================
// Initial aus URL-Query ?month=YYYY-MM, sonst aktueller Monat. Validation
// greift via isValidMonthYYYYMM — ungültige Werte fallen still auf den
// aktuellen Monat zurück (deep-linkbar ohne explizite Fehlermeldung).
//
// Pattern-Vorbild: useTransactionList für /transactions/expenses — gleiche
// URL-Sync-Strategie (router.replace statt push, Default-Monat ohne Query).
const month = ref<string>(
  typeof route.query.month === 'string' && isValidMonthYYYYMM(route.query.month)
    ? route.query.month
    : currentMonthYYYYMM(),
)
const monthLabel = computed(() => formatMonthLabel(month.value))

// Prev/Next-Stepper + „Jetzt"-Badge leben jetzt in <MonthSwitcher> (issue #96).

// URL-Sync + Reload. Wie in useTransactionList: aktueller Monat -> Query
// loeschen (saubere Default-URL), andere Monate -> ?month=YYYY-MM.
async function onMonthChange(newMonth: string) {
  if (!isValidMonthYYYYMM(newMonth)) {
    month.value = currentMonthYYYYMM()
    return
  }
  month.value = newMonth
  const current = currentMonthYYYYMM()
  const query = newMonth === current ? {} : { month: newMonth }
  await router.replace({ query })
  await loadOverview()
}

const budgetForm = ref({
  name: '',
  amount: null as number | null,
  frequency: 'MONTHLY' as Frequency,
  validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
})
const budgetEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

// === Month-gefilterte Budget-Liste (issue #67) =========================
// /api/households/current liefert ALLE Budgets eines Haushalts (monats-
// unabhaengig, weil Namen/Versionen/Mengen selbst keinen Monats-Bezug
// haben). Beim Blaettern im Month-Spinner sollen aber nur die Budgets
// angezeigt werden, die in dem ausgewaehlten Monat bereits gaeltig
// waren — sonst sieht der User ein Budget mit "gueltig ab 2026-08" in
// der Juli-Liste, obwohl es in Juli noch keine Auslastung hatte.
//
// `versions[0]` ist per Prisma-Query (server/api/households/current.get.ts
// Zeile 95) bereits nach `validFrom: 'desc'` sortiert, also die neueste
// Version. Ein Budget gilt ab dem `validFrom` seiner neuesten Version
// (aeltere Versionen wurden durch Updates ersetzt und sind nur fuer die
// Historienansicht interessant). Filter: neueste Version.validFrom <=
// Monatsende (= Anfang des naechsten Monats, exklusiv).
const monthEnd = computed<Date | null>(() => {
  const range = parseMonthRange(month.value)
  return range ? range.end : null
})

const monthStart = computed<Date | null>(() => parseMonthRange(month.value)?.start ?? null)

const visibleBudgets = computed(() => {
  const budgets = currentHousehold.value?.budgets ?? []
  if (!monthEnd.value) return budgets
  // Sichtbar, sobald IRGENDEINE Version bis Monatsende beginnt. Nur die
  // neueste Version zu pruefen hat ein Budget nach einer Betrags-Aenderung
  // in allen Monaten davor ausgeblendet (User-Report 2026-10-11).
  // ADR-0004: Ein geschlossenes Budget verschwindet ab dem ersten Monat,
  // der komplett nach seinem Stichtag liegt — sein Saldo lebt im Ziel weiter.
  return budgets.filter((budget) =>
    budget.versions.some((version) => new Date(version.validFrom) <= monthEnd.value!)
    && !(budget.closedAt && monthStart.value && new Date(budget.closedAt) <= monthStart.value),
  )
})

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const showFirstTimeEmpty = computed(
  () => (currentHousehold.value?.budgets.length ?? 0) === 0 && isFirstRunHousehold.value,
)

const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)
const formatDate = formatPlanningDate

// Haushalt-Daten sind monats-unabhaengig (Budgets mit Versionen, Namen).
// Einmal geladen, nur Overview wechselt pro Monat.
async function loadHousehold() {
  loading.value = true
  try {
    const data = await $fetch<{ household: PlanningHousehold | null }>('/api/households/current')
    currentHousehold.value = data.household
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Planungsdaten konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

// Monats-spezifischer Overview-Load gegen den dedizierten Endpoint.
// Endpoint akzeptiert ?month=YYYY-MM, validiert und 400'd bei Müll.
async function loadOverview() {
  if (!activeHouseholdId.value) {
    budgetOverview.value = null
    return
  }
  budgetLoading.value = true
  try {
    const data = await $fetch<{ budgetOverview: BudgetOverview | null }>(
      `/api/households/${activeHouseholdId.value}/budget-overview`,
      { params: { month: month.value } },
    )
    budgetOverview.value = data.budgetOverview ?? null
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Budgetübersicht konnte nicht geladen werden: ' + (error.statusMessage || error.message) }
    budgetOverview.value = null
  } finally {
    budgetLoading.value = false
  }
}

const loadPlanning = async () => {
  await Promise.all([loadHousehold(), loadOverview()])
}

const resetBudgetForm = () => {
  budgetForm.value = {
    name: '',
    amount: null,
    frequency: 'MONTHLY',
    validFrom: getPeriodStartDate(new Date(), 'MONTHLY'),
  }
  budgetEditId.value = null
}

const editBudget = (budget: BudgetItem) => {
  budgetEditId.value = budget.id
  const latestVersion = budget.versions[0]
  budgetForm.value = {
    name: budget.name,
    amount: latestVersion ? latestVersion.amount / 100 : null,
    frequency: budget.frequency,
    validFrom: latestVersion ? new Date(latestVersion.validFrom) : new Date(),
  }
  budgetDialogOpen.value = true
}

const openBudgetDialog = () => { resetBudgetForm(); budgetDialogOpen.value = true }
const closeBudgetDialog = () => { budgetDialogOpen.value = false; resetBudgetForm() }

watch(
  () => budgetForm.value.frequency,
  (frequency) => {
    if (!budgetEditId.value) {
      budgetForm.value.validFrom = getPeriodStartDate(new Date(), frequency)
    }
  },
)

const saveBudget = async () => {
  if (!activeHouseholdId.value) return
  budgetLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(budgetEditId.value)
    const payload = {
      kind: 'budget',
      ...(budgetEditId.value ? { id: budgetEditId.value } : {}),
      name: budgetForm.value.name,
      amount: budgetForm.value.amount,
      // ADR-0004: Frequenz nur beim Anlegen — danach unveraenderlich.
      ...(budgetEditId.value ? {} : { frequency: budgetForm.value.frequency }),
      validFrom: formatDateToInputString(budgetForm.value.validFrom),
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: budgetEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadPlanning()
    closeBudgetDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Budget wurde aktualisiert.' : 'Budget wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Budget konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    budgetLoading.value = false
  }
}

const deletePlanningItem = async (budget: { id: string; name: string }) => {
  if (!activeHouseholdId.value) return

  // ConfirmSheet (issue #51): wir haben hier KEIN Undo (im Gegensatz zu
  // Transaktionen via Soft-Delete), also ist der Sheet die einzige
  // Sicherung gegen Fehlklicks. Confirm-Text nennt das konkrete Budget.
  const ok = await confirm.ask({
    title: 'Budget löschen?',
    message: `„${budget.name}" wird endgültig entfernt. Das geht nur, solange noch nichts darauf gebucht wurde — sonst das Budget stattdessen schließen.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  actionLoadingKey.value = `budget:${budget.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/budgets/${budget.id}`, {
      method: 'DELETE',
    })
    await loadPlanning()
    notice.value = { severity: 'success', text: 'Eintrag wurde gelöscht.' }
  } catch (error: any) {
    // ADR-0004: 409 = Budget hat Buchungen, Umbuchungen oder Vorgaenger.
    notice.value = error.statusCode === 409
      ? { severity: 'warn', text: `„${budget.name}" hat bereits Buchungen und kann nicht gelöscht werden. Schließe es stattdessen in ein anderes Budget.` }
      : { severity: 'error', text: 'Eintrag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

// === ADR-0004: Saldo, Schließen, Umbuchen =============================
const budgetsById = computed(() => new Map((currentHousehold.value?.budgets ?? []).map((budget) => [budget.id, budget] as const)))
const budgetName = (budgetId: string | null) => (budgetId ? budgetsById.value.get(budgetId)?.name ?? '—' : '—')
const isClosed = (budget: BudgetItem) => Boolean(budget.closedAt)

// ADR-0004: Saldo-Verlauf pro Budget aufklappbar. Zu, bis der Nutzer ihn
// oeffnet — der Verlauf kostet einen eigenen Request und die Liste soll
// kompakt bleiben.
const expandedHistory = ref<Record<string, boolean>>({})
const toggleHistory = (budgetId: string) => {
  expandedHistory.value = { ...expandedHistory.value, [budgetId]: !expandedHistory.value[budgetId] }
}

// Schließen: Stichtag (Periodenbeginn) + Pflicht-Ziel. Default ist der
// naechste Periodenbeginn, damit die laufende Periode noch genutzt wird.
const closeDialogOpen = ref(false)
const closeSaving = ref(false)
const closeError = ref<string | null>(null)
const closeForm = ref({
  budgetId: '' as string,
  closedAt: new Date() as Date | null,
  targetId: null as string | null,
})
const closingBudget = computed(() => budgetsById.value.get(closeForm.value.budgetId) ?? null)
const closeDialogHeader = computed(() => `„${closingBudget.value?.name ?? ''}“ schließen`)
// Ziel: anderes Budget, das am Stichtag noch offen ist (sonst Zyklus).
const closeTargetOptions = computed(() =>
  budgetsOpenOn(
    (currentHousehold.value?.budgets ?? []).filter((budget) => budget.id !== closeForm.value.budgetId),
    closeForm.value.closedAt,
  ).map((budget) => ({ label: budget.name, value: budget.id })),
)

function openCloseDialog(budget: BudgetItem) {
  closeForm.value = {
    budgetId: budget.id,
    closedAt: getNextPeriodStartDate(new Date(), budget.frequency),
    targetId: null,
  }
  closeError.value = null
  closeDialogOpen.value = true
}

async function saveClose() {
  if (!activeHouseholdId.value || !closingBudget.value) return
  if (!closeForm.value.closedAt) {
    closeError.value = 'Bitte einen Stichtag wählen.'
    return
  }
  if (!closeForm.value.targetId) {
    closeError.value = 'Bitte ein Ziel-Budget wählen — der Saldo darf nicht verschwinden.'
    return
  }
  closeSaving.value = true
  closeError.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/budgets/${closingBudget.value.id}/close`, {
      method: 'POST',
      body: {
        closedAt: formatDateToInputString(closeForm.value.closedAt),
        carryoverToBudgetId: closeForm.value.targetId,
      },
    })
    closeDialogOpen.value = false
    await loadPlanning()
    notice.value = { severity: 'success', text: `„${closingBudget.value?.name ?? 'Budget'}" wurde geschlossen.` }
  } catch (error: any) {
    closeError.value = error.statusCode === 409
      ? 'Es gibt Buchungen ab dem Stichtag. Bitte zuerst auf ein anderes Budget umhängen oder einen späteren Stichtag wählen.'
      : 'Budget konnte nicht geschlossen werden: ' + (error.statusMessage || error.message)
  } finally {
    closeSaving.value = false
  }
}

// Umbuchen Budget <-> Spartopf: eine SavingsGoalExecution mit
// sourceBudgetId. Richtung als Auswahl statt Vorzeichen-Eingabe.
const transferDialogOpen = ref(false)
const transferSaving = ref(false)
const transferError = ref<string | null>(null)
const transferForm = ref({
  budgetId: '' as string,
  goalId: null as string | null,
  direction: 'toGoal' as 'toGoal' | 'toBudget',
  amount: null as number | null,
  date: new Date() as Date | null,
  note: '',
})
const transferBudget = computed(() => budgetsById.value.get(transferForm.value.budgetId) ?? null)
const transferDialogHeader = computed(() => `Umbuchen: ${transferBudget.value?.name ?? ''}`)
const transferNotePlaceholder = computed(() => `Umbuchung ${transferBudget.value?.name ?? ''}`)
const savingsGoalOptions = computed(() =>
  (currentHousehold.value?.savingsGoals ?? []).map((goal) => ({ label: goal.name, value: goal.id })),
)
const transferDirectionOptions = [
  { label: 'Vom Budget in den Spartopf', value: 'toGoal' },
  { label: 'Aus dem Spartopf ins Budget', value: 'toBudget' },
]
// Kein Saldo-Limit (ADR-0004), nur ein Hinweis, wenn der Saldo dadurch
// negativ wird.
const transferOverdraws = computed(() =>
  transferForm.value.direction === 'toGoal'
  && transferBudget.value !== null
  && transferForm.value.amount !== null
  && Math.round(transferForm.value.amount * 100) > transferBudget.value.balance,
)

function openTransferDialog(budget: BudgetItem) {
  transferForm.value = {
    budgetId: budget.id,
    goalId: savingsGoalOptions.value[0]?.value ?? null,
    direction: 'toGoal',
    amount: budget.balance > 0 ? budget.balance / 100 : null,
    date: new Date(),
    note: '',
  }
  transferError.value = null
  transferDialogOpen.value = true
}

async function saveTransfer() {
  if (!activeHouseholdId.value || !transferBudget.value) return
  if (!transferForm.value.goalId) {
    transferError.value = 'Bitte einen Spartopf wählen.'
    return
  }
  if (transferForm.value.amount == null || transferForm.value.amount <= 0) {
    transferError.value = 'Betrag muss größer als 0 sein.'
    return
  }
  if (!transferForm.value.date) {
    transferError.value = 'Bitte ein Datum wählen.'
    return
  }
  if (!isBudgetOpenOn(transferBudget.value, transferForm.value.date)) {
    transferError.value = 'Das Budget ist zu diesem Datum bereits geschlossen.'
    return
  }
  transferSaving.value = true
  transferError.value = null
  try {
    const signed = transferForm.value.direction === 'toGoal' ? transferForm.value.amount : -transferForm.value.amount
    await $fetch(`/api/households/${activeHouseholdId.value}/savings-goals/${transferForm.value.goalId}/executions`, {
      method: 'POST',
      body: {
        amount: signed,
        date: formatDateToInputString(transferForm.value.date),
        note: transferForm.value.note || `Umbuchung ${transferBudget.value.name}`,
        sourceBudgetId: transferBudget.value.id,
      },
    })
    transferDialogOpen.value = false
    await loadPlanning()
    notice.value = { severity: 'success', text: 'Umbuchung wurde gespeichert.' }
  } catch (error: any) {
    transferError.value = 'Umbuchung fehlgeschlagen: ' + (error.statusMessage || error.message)
  } finally {
    transferSaving.value = false
  }
}

const budgetOverviewMap = computed(
  () => new Map(budgetOverview.value?.budgets.map((item) => [item.budgetId, item] as const) ?? []),
)
// Issue #82-Regression-Fix (User-Report 2026-08-27): liefert einen
// leeren Default-Wert statt null, damit der Template-Code keine
// Non-Null-Assertions ("!") braucht. Vorher warf "!.x" einen
// TypeError sobald budgetOverview noch nicht geladen war, was die
// ganze Page unrenderable machte.
const EMPTY_OVERVIEW_ITEM: BudgetOverviewItem = {
  budgetId: '',
  key: '',
  name: '',
  currentAmount: null,
  currentFrequency: null,
  currentValidFrom: null,
  plannedAmount: 0,
  spentAmount: 0,
  remainingAmount: 0,
  periodCount: 0,
  versionCount: 0,
  nextChange: null,
  periods: [],
}

const getBudgetOverviewItem = (budgetId: string): BudgetOverviewItem =>
  budgetOverviewMap.value.get(budgetId) ?? EMPTY_OVERVIEW_ITEM

// === Issue #82: Wochen-Label ============================================
// "KW 34 (18.–24. Aug)" — ISO-Kalenderwoche + Datums-Range. Konsistent
// mit der Dashboard-Variante, dupliziert gehalten (Komponenten-Extraktion
// waere overkill fuer 12 Zeilen Logik).
const weekDayFormatter = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })

function isoWeekNumber(date: Date): number {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const dayNum = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNum + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

function periodLabel(period: { start: string; end: string }): string {
  const start = new Date(period.start)
  // end ist exklusiv (start + 7d) — fuer die Anzeige einen Tag abziehen.
  const endDisplay = new Date(period.end)
  endDisplay.setDate(endDisplay.getDate() - 1)
  const kw = isoWeekNumber(start)
  const startStr = weekDayFormatter.format(start).replace(/\./g, '').trim()
  const endStr = weekDayFormatter.format(endDisplay).replace(/\./g, '').trim()
  return `KW ${kw} (${startStr}–${endStr})`
}

onMounted(async () => {
  await fetchHouseholds()
  await loadPlanning()
})
watch(activeHouseholdId, async () => { await loadPlanning() })
</script>

<template>
  <ListPageShell title="Budget pro Zeitraum">
    <template #summary>
      <Tag severity="info" :value="`Geplant ${formatMoney(budgetOverview?.plannedTotal ?? 0)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(budgetOverview?.spentTotal ?? 0)}`" />
      <Tag severity="success" :value="`Rest ${formatMoney(budgetOverview?.remainingTotal ?? 0)}`" />
    </template>

    <template #toolbar>
      <!-- Monatswechsler (issue #34 / #96): deep-linkbar via ?month=YYYY-MM,
           aktueller Monat mit grünem 'Jetzt'-Badge. -->
      <MonthSwitcher :model-value="month" :loading="budgetLoading" @update:model-value="onMonthChange" />
      <!-- Issue #99: Toolbar-Button nur, wenn nicht schon der First-Time-
           EmptyState seine eigene CTA zeigt ("ein Anlegen-Affordance pro
           Seite"). Nur den Button ausblenden, der MonthSwitcher bleibt. -->
      <Button v-if="canManageHousehold && !showFirstTimeEmpty" label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <!-- OWNER-only Erklaerung (issue #128): Budgets anlegen/bearbeiten/loeschen
         sind serverseitig Owner-only. MEMBER sehen die Aktionen gar nicht erst;
         der Hinweis sagt ihnen, warum. Muster wie auf households/members.vue. -->
    <Message v-if="activeHousehold && !canManageHousehold" severity="warn" variant="simple">
      Nur Owner können Budgets anlegen, bearbeiten und löschen. Bitte an einen Haushalts-Owner wenden, wenn etwas geändert werden soll.
    </Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Budgetdaten werden geladen"
      loading-text="Wir holen den aktuellen Haushalt und die vorhandenen Budgets."
    />

    <EmptyState
      v-if="!loading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-chart-line"
      icon-tone="accent"
      headline="Noch keine Budgets"
      :description="canManageHousehold
        ? 'Lege dein erstes Budget an, um Ausgaben pro Kategorie zu planen — z. B. Lebensmittel, Miete, Freizeit.'
        : 'Ein Owner des Haushalts kann Budgets anlegen, um Ausgaben pro Kategorie zu planen.'"
      :cta="canManageHousehold
        ? { label: 'Budget anlegen', onClick: openBudgetDialog, severity: 'primary' }
        : undefined"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && currentHousehold.budgets.length === 0"
      variant="no-data"
      icon="pi pi-chart-line"
      icon-tone="muted"
      headline="Keine Budgets"
      :description="canManageHousehold
        ? 'Lege ein Budget an, um Auswertungen pro Kategorie zu sehen.'
        : 'Ein Owner des Haushalts kann ein Budget anlegen, um Auswertungen pro Kategorie zu sehen.'"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && visibleBudgets.length === 0"
      variant="no-data"
      icon="pi pi-calendar"
      icon-tone="muted"
      headline="Keine Budgets in diesem Monat"
      :description="canManageHousehold
        ? `Deine ${currentHousehold.budgets.length} Budgets sind erst ab einem späteren Zeitpunkt gültig. Blättere vorwärts oder lege ein neues Budget mit früherem \`validFrom\` an.`
        : `Die ${currentHousehold.budgets.length} Budgets des Haushalts sind erst ab einem späteren Zeitpunkt gültig. Blättere vorwärts.`"
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold && visibleBudgets.length > 0"
      variant="primary"
      compact
      :badge="`${visibleBudgets.length} Einträge`"
    >
      <template v-for="budget in visibleBudgets" :key="budget.id">
      <SwipeableListItem
        :disabled="swipeDisabled"
        swipe-right-icon="pi pi-pen-to-square"
        swipe-right-label="Bearbeiten"
        swipe-left-icon="pi pi-trash"
        swipe-left-label="Löschen"
        @swipe-right="editBudget(budget)"
        @swipe-left="deletePlanningItem(budget)"
      >
      <ItemCard variant="primary">
        <template #main>
          <span class="row-title">{{ budget.name }}</span>
          <span class="row-sub">
            <span v-if="getBudgetOverviewItem(budget.id).currentFrequency" class="row-tag">
              {{ frequencyLabel(getBudgetOverviewItem(budget.id).currentFrequency!) }}
            </span>
            <span v-if="isClosed(budget)" class="row-tag-closed">
              geschlossen ab {{ formatDate(budget.closedAt) }} → {{ budgetName(budget.carryoverToBudgetId) }}
            </span>
            <span>gültig ab {{ formatDate(getBudgetOverviewItem(budget.id).currentValidFrom) }}</span>
            <span>·</span>
            <span>{{ getBudgetOverviewItem(budget.id).periodCount }} Perioden</span>
            <template v-if="getBudgetOverviewItem(budget.id).nextChange">
              <span>·</span>
              <span class="row-next-change">
                ab {{ formatDate(getBudgetOverviewItem(budget.id).nextChange!.validFrom) }}:
                {{ formatMoney(getBudgetOverviewItem(budget.id).nextChange!.amount) }}
              </span>
            </template>
          </span>
        </template>
        <template #progress>
          <ListProgressBar
            :percent="getBudgetOverviewItem(budget.id).plannedAmount
              ? (getBudgetOverviewItem(budget.id).spentAmount / getBudgetOverviewItem(budget.id).plannedAmount) * 100
              : 0"
            tone="auto"
            :label="`${formatMoney(getBudgetOverviewItem(budget.id).spentAmount)} / ${formatMoney(getBudgetOverviewItem(budget.id).plannedAmount)}`"
          />
        </template>
        <!-- ADR-0004: Saldo des virtuellen Kontos — "wie viel ist insgesamt
             noch da?", unabhaengig vom angezeigten Monat. -->
        <template #aside>
          <div class="balance" :class="{ 'balance--negative': budget.balance < 0 }">
            {{ formatMoney(budget.balance) }}
            <span class="amount-secondary">Saldo</span>
          </div>
        </template>
        <!-- Verlauf, Umbuchen (alle Mitglieder) und Schließen (Owner) als
             Text-Buttons unter dem Titel, damit sie auch mobil ohne Swipe
             erreichbar sind. Verlauf auch bei geschlossenen Budgets. -->
        <template #meta>
          <div class="row-actions">
            <Button
              :label="expandedHistory[budget.id] ? 'Verlauf ausblenden' : 'Verlauf'"
              icon="pi pi-chart-line"
              size="small"
              severity="secondary"
              text
              :aria-expanded="Boolean(expandedHistory[budget.id])"
              @click="toggleHistory(budget.id)"
            />
            <Button
              v-if="!isClosed(budget) && savingsGoalOptions.length > 0"
              label="Umbuchen"
              icon="pi pi-arrow-right-arrow-left"
              size="small"
              text
              @click="openTransferDialog(budget)"
            />
            <Button
              v-if="!isClosed(budget) && canManageHousehold"
              label="Schließen"
              icon="pi pi-lock"
              size="small"
              severity="secondary"
              text
              @click="openCloseDialog(budget)"
            />
          </div>
        </template>
        <!-- Bearbeiten/Loeschen nur ab 640px als Buttons; mobil ersetzt durch
             Swipe (issue #132), siehe #actions-desktop in ItemCard. -->
        <template v-if="canManageHousehold" #actions-desktop>
          <Button v-if="!isClosed(budget)" icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Budget bearbeiten" @click="editBudget(budget)" />
          <Button
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            text
            aria-label="Budget löschen"
            :loading="actionLoadingKey === `budget:${budget.id}`"
            @click="deletePlanningItem(budget)"
          />
        </template>
      </ItemCard>
      </SwipeableListItem>

      <BudgetBalanceHistory
        v-if="expandedHistory[budget.id] && activeHousehold"
        :household-id="activeHousehold.id"
        :budget-id="budget.id"
        :format-money="formatMoney"
      />

      <!-- Issue #82: Wochen-Detail fuer WEEKLY-Budgets auf der Detail-Seite.
           Anders als auf dem Dashboard hier IMMER aufgeklappt — Detail-Kontext,
           Whitespace ist hier ok. Kein Toggle noetig.
           Wichtig: muss INNERHALB des v-for-Blocks sein, weil `budget.id` sonst
           nicht im Scope ist (Vue 3 v-for-Scoping: Variable nur in direkten
           Children sichtbar, nicht in Siblings). User-Report 2026-08-27 hat das
           aufgedeckt. -->
      <ul
        v-if="getBudgetOverviewItem(budget.id).currentFrequency === 'WEEKLY' && getBudgetOverviewItem(budget.id).periods.length > 0"
        class="weekly-breakdown"
      >
        <li
          v-for="(period, periodIndex) in getBudgetOverviewItem(budget.id).periods"
          :key="`${budget.id}-period-${periodIndex}`"
          class="weekly-breakdown__item"
        >
          <div class="weekly-breakdown__head">
            <span class="weekly-breakdown__label">{{ periodLabel(period) }}</span>
            <span class="weekly-breakdown__pct" :class="`severity--${period.severity}`">
              {{ period.percentUsed.toFixed(0) }}%
            </span>
          </div>
          <ListProgressBar
            :percent="period.percentUsed"
            :tone="period.severity"
            :label="`${formatMoney(period.spentAmount)} / ${formatMoney(period.plannedAmount)}`"
          />
        </li>
      </ul>
      </template>

      <ItemCard v-if="budgetOverview" variant="muted">
        <template #main>
          <span class="row-title">Sonstiges <span class="row-tag-muted">Auto-Bucket</span></span>
          <span class="row-sub">Virtuelle Kategorie für Ausgaben ohne Budgetzuordnung</span>
        </template>
        <template #aside>
          <div>
            {{ formatMoney(budgetOverview.unassigned.spentAmount) }}
            <span class="amount-secondary">verbraucht</span>
          </div>
        </template>
      </ItemCard>

      <div v-if="currentHousehold.budgets.length === 0" class="empty-list">
        Noch keine Budgets angelegt.
      </div>
    </ListPanel>

    <FormDialog
      v-model:visible="budgetDialogOpen"
      :header="budgetEditId ? 'Budget bearbeiten' : 'Budget anlegen'"
      :submit-label="budgetEditId ? 'Budget aktualisieren' : 'Budget anlegen'"
      :saving="budgetLoading"
      @save="saveBudget"
      @cancel="closeBudgetDialog"
    >
      <BudgetForm v-model="budgetForm" :currency="currencyCode" :frequency-locked="Boolean(budgetEditId)" />
    </FormDialog>

    <!-- ADR-0004: Budget schließen — Saldo fließt per Verweis ins Ziel. -->
    <FormDialog
      v-model:visible="closeDialogOpen"
      :header="closeDialogHeader"
      submit-label="Budget schließen"
      submit-severity="danger"
      :saving="closeSaving"
      @save="saveClose"
      @cancel="closeDialogOpen = false"
    >
      <p class="dialog-hint">
        Ab dem Stichtag bekommt das Budget keine Zuteilungen mehr und nimmt keine Buchungen mehr an.
        Sein Saldo ({{ formatMoney(closingBudget?.balance ?? 0) }}) fließt ins Ziel-Budget — auch spätere Korrekturen von Buchungen vor dem Stichtag.
        Für einen Wechsel der Frequenz zuerst das neue Budget anlegen, dann das alte hinein schließen.
      </p>
      <FormFieldRow label="Stichtag" html-for="close-date">
        <DatePicker id="close-date" v-model="closeForm.closedAt" show-icon date-format="dd.mm.yy" />
      </FormFieldRow>
      <FormFieldRow label="Ziel-Budget" html-for="close-target" wide>
        <Select
          id="close-target"
          v-model="closeForm.targetId"
          :options="closeTargetOptions"
          option-label="label"
          option-value="value"
          placeholder="Budget wählen"
          empty-message="Kein offenes Budget — zuerst ein neues anlegen"
        />
      </FormFieldRow>
      <Message v-if="closeError" severity="error" variant="simple">{{ closeError }}</Message>
    </FormDialog>

    <!-- ADR-0004: Umbuchung Budget <-> Spartopf (eine Execution mit sourceBudgetId). -->
    <FormDialog
      v-model:visible="transferDialogOpen"
      :header="transferDialogHeader"
      submit-label="Umbuchen"
      :saving="transferSaving"
      @save="saveTransfer"
      @cancel="transferDialogOpen = false"
    >
      <p class="dialog-hint">Aktueller Saldo: {{ formatMoney(transferBudget?.balance ?? 0) }}</p>
      <FormFieldRow label="Richtung" html-for="transfer-direction" wide>
        <Select
          id="transfer-direction"
          v-model="transferForm.direction"
          :options="transferDirectionOptions"
          option-label="label"
          option-value="value"
        />
      </FormFieldRow>
      <FormFieldRow label="Spartopf" html-for="transfer-goal" wide>
        <Select
          id="transfer-goal"
          v-model="transferForm.goalId"
          :options="savingsGoalOptions"
          option-label="label"
          option-value="value"
          placeholder="Spartopf wählen"
        />
      </FormFieldRow>
      <FormFieldRow label="Betrag" html-for="transfer-amount">
        <MoneyInput id="transfer-amount" v-model="transferForm.amount" :currency="currencyCode" />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="transfer-date" subtle>
        <DatePicker id="transfer-date" v-model="transferForm.date" show-icon date-format="dd.mm.yy" />
      </FormFieldRow>
      <FormFieldRow label="Notiz" html-for="transfer-note" wide>
        <InputText id="transfer-note" v-model="transferForm.note" :placeholder="transferNotePlaceholder" />
      </FormFieldRow>
      <Message v-if="transferOverdraws" severity="warn" variant="simple">
        Der Saldo des Budgets wird dadurch negativ.
      </Message>
      <Message v-if="transferError" severity="error" variant="simple">{{ transferError }}</Message>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.row-title {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.row-sub {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.row-tag {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(59, 130, 246, 0.16);
  color: var(--color-accent-primary-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.row-tag-closed {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(148, 163, 184, 0.16);
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
}

.balance {
  text-align: right;
  font-weight: 600;
  color: var(--color-text-primary);
}

.balance--negative {
  color: var(--color-accent-danger-text);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: -8px;
}

.dialog-hint {
  margin: 0 0 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.row-next-change {
  color: var(--color-accent-primary-text);
}

.row-tag-muted {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(251, 191, 36, 0.12);
  color: var(--color-accent-warning-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  margin-left: 6px;
}

.amount-secondary {
  display: block;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-weight: 500;
  margin-top: 2px;
}

.empty-list {
  padding: 16px;
  border-radius: 10px;
  border: 1px dashed var(--color-border-default);
  color: var(--color-text-muted);
  text-align: center;
  font-size: 0.85rem;
}

/* Issue #82: Wochen-Breakdown-Liste unter dem ItemCard. */
.weekly-breakdown {
  list-style: none;
  padding: 0.6rem 0 0.6rem 1.25rem;
  margin: 0.4rem 0 0.8rem;
  border-left: 2px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.weekly-breakdown__item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.weekly-breakdown__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.weekly-breakdown__label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.weekly-breakdown__pct {
  font-size: 0.82rem;
  font-weight: 600;
}

.severity--ok {
  color: var(--color-text-secondary);
}

.severity--warning {
  color: var(--color-accent-warning-text);
}

.severity--over {
  color: var(--color-accent-danger-text);
}
</style>
