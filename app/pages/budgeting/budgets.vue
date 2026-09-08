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
}

import { isFirstRun } from '~/utils/household-age'
import { currentMonthYYYYMM, isValidMonthYYYYMM, formatMonthLabel, parseMonthRange } from '~/utils/month-filter'

const { activeHousehold, fetchHouseholds } = useHousehold()
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

const visibleBudgets = computed(() => {
  const budgets = currentHousehold.value?.budgets ?? []
  if (!monthEnd.value) return budgets
  return budgets.filter((budget) => {
    const latestVersion = budget.versions[0]
    if (!latestVersion) return false
    return new Date(latestVersion.validFrom) <= monthEnd.value!
  })
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
    frequency: latestVersion?.frequency ?? 'MONTHLY',
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
      frequency: budgetForm.value.frequency,
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
    message: `„${budget.name}" wird endgültig entfernt. Bereits gebuchte Ausgaben behalten das Budget-Label, der Topf-Betrag wird zurückgerechnet.`,
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
    notice.value = { severity: 'error', text: 'Eintrag konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
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
  <ListPageShell
    title="Budget pro Zeitraum"
    description="Plane, wie viel du pro Periode für einzelne Kategorien ausgeben willst. Die Progress-Bar zeigt, wie viel vom monatlichen Budget bereits verbraucht ist."
  >
    <template #summary>
      <Tag severity="info" :value="`Geplant ${formatMoney(budgetOverview?.plannedTotal ?? 0)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(budgetOverview?.spentTotal ?? 0)}`" />
      <Tag severity="success" :value="`Rest ${formatMoney(budgetOverview?.remainingTotal ?? 0)}`" />
    </template>

    <template #toolbar>
      <!-- Monatswechsler (issue #34 / #96): deep-linkbar via ?month=YYYY-MM,
           aktueller Monat mit grünem 'Jetzt'-Badge. -->
      <MonthSwitcher :model-value="month" :loading="budgetLoading" @update:model-value="onMonthChange" />
      <Button label="Budget anlegen" icon="pi pi-plus" severity="success" @click="openBudgetDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

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
      description="Lege dein erstes Budget an, um Ausgaben pro Kategorie zu planen — z. B. Lebensmittel, Miete, Freizeit."
      :cta="{ label: 'Budget anlegen', onClick: openBudgetDialog, severity: 'primary' }"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && currentHousehold.budgets.length === 0"
      variant="no-data"
      icon="pi pi-chart-line"
      icon-tone="muted"
      headline="Keine Budgets"
      description="Lege ein Budget an, um Auswertungen pro Kategorie zu sehen."
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && visibleBudgets.length === 0"
      variant="no-data"
      icon="pi pi-calendar"
      icon-tone="muted"
      headline="Keine Budgets in diesem Monat"
      :description="`Deine ${currentHousehold.budgets.length} Budgets sind erst ab einem späteren Zeitpunkt gültig. Blättere vorwärts oder lege ein neues Budget mit früherem \`validFrom\` an.`"
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold && visibleBudgets.length > 0"
      variant="primary"
      compact
      :badge="`${visibleBudgets.length} Einträge`"
    >
      <template v-for="budget in visibleBudgets" :key="budget.id">
      <ItemCard variant="primary">
        <template #main>
          <span class="row-title">{{ budget.name }}</span>
          <span class="row-sub">
            <span v-if="getBudgetOverviewItem(budget.id).currentFrequency" class="row-tag">
              {{ frequencyLabel(getBudgetOverviewItem(budget.id).currentFrequency!) }}
            </span>
            <span>gültig ab {{ formatDate(getBudgetOverviewItem(budget.id).currentValidFrom) }}</span>
            <span>·</span>
            <span>{{ getBudgetOverviewItem(budget.id).periodCount }} Perioden</span>
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
        <template #actions>
          <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Budget bearbeiten" @click="editBudget(budget)" />
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
      <BudgetForm v-model="budgetForm" :currency="currencyCode" />
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
  color: #93c5fd;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.row-tag-muted {
  display: inline-block;
  padding: 1px 7px;
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
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
  border: 1px dashed rgba(148, 163, 184, 0.18);
  color: var(--color-text-muted);
  text-align: center;
  font-size: 0.85rem;
}

/* Issue #82: Wochen-Breakdown-Liste unter dem ItemCard. */
.weekly-breakdown {
  list-style: none;
  padding: 0.6rem 0 0.6rem 1.25rem;
  margin: 0.4rem 0 0.8rem;
  border-left: 2px solid rgba(148, 163, 184, 0.18);
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
  color: #cbd5e1;
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
