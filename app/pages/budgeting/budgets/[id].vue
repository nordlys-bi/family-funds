<!--
  Budget-Detailseite (ADR-0004): ein Budget als virtuelles Konto.

  Saldo und Saldo-Verlauf stehen oben und gross — das ist die Hauptfrage
  ("wie viel ist da, wie hat es sich entwickelt?"). Darunter die laufende
  Periode mit Forecast, die Ereignisliste (jede Zuteilung, Ausgabe,
  Umbuchung, Uebertrag), verknuepfte Vorgaenger/Nachfolger und die
  Versionen.

  Der aktive Haushalt kommt wie ueberall aus useHousehold; eine ID, die es
  im Haushalt nicht gibt (unbekannt, fremd oder kein UUID), zeigt eine
  eigene Nicht-gefunden-Ansicht statt eines leeren Skeletts.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Notice } from '~/types/planning'
import type { BalanceHistoryEntry, BalanceHistoryResponse, BudgetListItem } from '~/types/budget'
import type { BalanceChartEvent } from '~/components/BudgetBalanceChart.vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const { activeHousehold, canManageHousehold, fetchHouseholds } = useHousehold()

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const budgetId = computed(() => String(route.params.id ?? ''))
const householdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')
const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)

const budgets = ref<BudgetListItem[]>([])
const savingsGoals = ref<Array<{ id: string; name: string }>>([])
const loading = ref(true)
const loaded = ref(false)
// Ladefehler getrennt von "nicht gefunden": Bei Netz-/500-Fehlern darf die
// Seite nicht behaupten, das Budget gebe es nicht (mehr).
const loadError = ref<string | null>(null)
const notice = ref<Notice | null>(null)
const dialogs = ref<{
  openEdit: (budget: BudgetListItem) => void
  openClose: (budget: BudgetListItem) => void
  openTransfer: (budget: BudgetListItem) => void
  remove: (budget: BudgetListItem) => Promise<void>
} | null>(null)

const budgetsById = computed(() => new Map(budgets.value.map((budget) => [budget.id, budget] as const)))
const budget = computed(() => budgetsById.value.get(budgetId.value) ?? null)
// Nicht gefunden nur bei ungueltiger ID oder wenn das Laden geklappt hat
// und das Budget im Haushalt fehlt — nie nach einem Ladefehler.
const notFound = computed(() =>
  !UUID_PATTERN.test(budgetId.value) || (loaded.value && !loadError.value && !budget.value),
)

const balance = computed(() => budget.value?.balance?.balance ?? 0)
const isClosed = computed(() => Boolean(budget.value?.closedAt && new Date(budget.value.closedAt) <= new Date()))
const hasClosingDate = computed(() => Boolean(budget.value?.closedAt))
const successor = computed(() =>
  budget.value?.carryoverToBudgetId ? budgetsById.value.get(budget.value.carryoverToBudgetId) ?? null : null,
)
// Geschlossen: Der Endsaldo steckt laut ADR-0004 bereits im Ziel-Budget.
// Deshalb neutral statt gruen/rot — sonst wirkt er wie verfuegbares Geld.
const balanceLabel = computed(() => (isClosed.value ? 'Endsaldo' : 'Saldo'))
const closingDateLabel = computed(() => formatPlanningDate(budget.value?.closedAt ?? null))
const predecessors = computed(() => budgets.value.filter((item) => item.carryoverToBudgetId === budgetId.value))
const period = computed(() => budget.value?.currentPeriod ?? null)

async function loadBudgets() {
  if (!householdId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null
  try {
    // Alle Budgets statt eines Einzel-Endpoints: Die Seite braucht ohnehin
    // Namen fuer Vorgaenger/Nachfolger und die Ziel-Auswahl beim Schliessen.
    // Spartoepfe nur fuer den Umbuchen-Dialog.
    const [budgetData, householdData] = await Promise.all([
      $fetch<{ budgets: BudgetListItem[] }>(`/api/households/${householdId.value}/budgets`),
      $fetch<{ household: { savingsGoals: Array<{ id: string; name: string }> } | null }>('/api/households/current'),
    ])
    budgets.value = budgetData.budgets
    savingsGoals.value = (householdData.household?.savingsGoals ?? []).map((goal) => ({ id: goal.id, name: goal.name }))
    loaded.value = true
  } catch (error: any) {
    loadError.value = error.statusMessage || error.message || 'Unbekannter Fehler'
    // Schlaegt ein Neuladen nach einer Aktion fehl, bleibt die bisherige
    // Ansicht stehen und der Fehler kommt als Hinweis darueber.
    if (budget.value) {
      notice.value = { severity: 'error', text: 'Budget konnte nicht neu geladen werden: ' + loadError.value }
    }
  } finally {
    loading.value = false
  }
}

// === Saldo-Verlauf =====================================================
const RANGES = [
  { months: 1, label: '1 M' },
  { months: 3, label: '3 M' },
  { months: 6, label: '6 M' },
  { months: 12, label: '12 M' },
] as const
// Default 3 Monate (abgestimmt): lang genug fuer ein paar Monatsperioden,
// kurz genug, dass Wochenstufen noch erkennbar sind.
const months = ref(3)
const history = ref<BalanceHistoryResponse | null>(null)
const historyLoading = ref(false)
const historyError = ref<string | null>(null)

function isoDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function loadHistory() {
  if (!householdId.value || !UUID_PATTERN.test(budgetId.value)) return
  historyLoading.value = true
  historyError.value = null
  const to = new Date()
  const from = new Date(to)
  from.setMonth(from.getMonth() - months.value)
  try {
    history.value = await $fetch<BalanceHistoryResponse>(
      `/api/households/${householdId.value}/budgets/${budgetId.value}/balance-history`,
      { query: { from: isoDay(from), to: isoDay(to) } },
    )
  } catch (error: any) {
    history.value = null
    // 404 zeigt bereits die Nicht-gefunden-Ansicht der Seite.
    historyError.value = error.statusCode === 404
      ? null
      : 'Verlauf konnte nicht geladen werden: ' + (error.statusMessage || error.message)
  } finally {
    historyLoading.value = false
  }
}

async function reload() {
  await Promise.all([loadBudgets(), loadHistory()])
}

onMounted(async () => {
  await fetchHouseholds()
  await reload()
})
watch(householdId, reload)
// Vorgaenger/Nachfolger-Links bleiben in derselben Komponente — bei neuer
// ID alles neu laden statt veraltete Daten zu zeigen.
watch(budgetId, () => {
  history.value = null
  notice.value = null
  reload()
})
watch(months, loadHistory)

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${day}.${month}.`
}

function longDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

/** Fremdes Budget der Kette dazuschreiben — sonst ist "Zuteilung" mehrdeutig. */
function chainSuffix(item: { budgetId: string; budgetName: string | null }) {
  return item.budgetId === budgetId.value || !item.budgetName ? '' : ` (${item.budgetName})`
}

const chartEvents = computed<BalanceChartEvent[]>(() =>
  (history.value?.events ?? []).map((event) => {
    const text = event.type === 'transfer'
      ? event.amount >= 0
        ? `Umbuchung in Spartopf −${formatMoney(event.amount)}`
        : `Umbuchung aus Spartopf +${formatMoney(-event.amount)}`
      : event.type === 'version'
        ? `Neue Zuteilung ${formatMoney(event.amount)} pro Periode`
        : `Übertrag aus „${event.fromBudgetName ?? 'Vorgänger'}“ ${formatMoney(event.amount)}`
    return { type: event.type, date: event.date, label: `${shortDate(event.date)} ${text}${chainSuffix(event)}` }
  }),
)

const ENTRY_ICONS: Record<BalanceHistoryEntry['type'], string> = {
  allocation: 'pi pi-plus-circle',
  expense: 'pi pi-shopping-cart',
  transfer: 'pi pi-arrow-right-arrow-left',
  carryover: 'pi pi-link',
}

function entryTitle(entry: BalanceHistoryEntry): string {
  switch (entry.type) {
    case 'allocation':
      return 'Zuteilung'
    case 'expense':
      return entry.text || 'Ausgabe'
    case 'transfer':
      return entry.amount < 0
        ? `Umbuchung in „${entry.savingsGoal?.name ?? 'Spartopf'}“`
        : `Umbuchung aus „${entry.savingsGoal?.name ?? 'Spartopf'}“`
    case 'carryover':
      return `Übertrag aus „${entry.fromBudgetName ?? 'Vorgänger'}“`
  }
}

// Neueste zuerst — wie ein Kontoauszug in der App gelesen wird.
const entries = computed(() => [...(history.value?.entries ?? [])].reverse())

const predecessorNames = computed(() =>
  (history.value?.chain ?? []).filter((item) => item.id !== budgetId.value).map((item) => item.name),
)

function periodTransactionsLink() {
  if (!budget.value || !period.value) return null
  return {
    path: '/transactions/expenses',
    query: {
      budgetId: budget.value.id,
      from: period.value.start,
      ...(period.value.end ? { to: period.value.end } : {}),
    },
  }
}

function onDeleted(id: string) {
  if (id === budgetId.value) router.push('/budgeting/budgets')
}
</script>

<template>
  <section class="budget-detail">
    <NuxtLink to="/budgeting/budgets" class="back-link">
      <i class="pi pi-arrow-left" aria-hidden="true" />
      Alle Budgets
    </NuxtLink>

    <EmptyState
      v-if="!notFound && !(loadError && !budget)"
      :loading="loading && !budget"
      :no-household="!loading && !activeHousehold"
      loading-title="Budget wird geladen"
      loading-text="Wir holen Saldo, Verlauf und Buchungen."
    />

    <EmptyState
      v-if="notFound && !loading"
      variant="no-data"
      icon="pi pi-question-circle"
      icon-tone="muted"
      headline="Budget nicht gefunden"
      description="Dieses Budget gibt es im aktiven Haushalt nicht (mehr). Vielleicht gehört es zu einem anderen Haushalt oder wurde gelöscht."
      :cta="{ label: 'Zur Budget-Liste', onClick: () => router.push('/budgeting/budgets'), severity: 'primary' }"
    />

    <EmptyState
      v-if="loadError && !budget && !loading && !notFound"
      variant="no-data"
      icon="pi pi-exclamation-triangle"
      icon-tone="warning"
      headline="Budget konnte nicht geladen werden"
      :description="`Bitte Verbindung prüfen und erneut versuchen. (${loadError})`"
      :cta="{ label: 'Erneut versuchen', onClick: loadBudgets, severity: 'primary' }"
    />

    <template v-if="budget && !notFound">
      <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

      <!-- Kopf: Name, Frequenz, Saldo gross -->
      <header class="detail-head">
        <div class="detail-head__title">
          <h1>{{ budget.name }}</h1>
          <div class="detail-head__tags">
            <span class="tag">{{ frequencyLabel(budget.frequency) }}</span>
            <span v-if="isClosed" class="tag tag--closed">geschlossen</span>
          </div>
        </div>
        <div class="detail-head__balance">
          <span
            class="detail-head__balance-value"
            :class="{ 'is-negative': balance < 0 && !isClosed, 'is-closed': isClosed }"
          >{{ formatMoney(balance) }}</span>
          <span class="detail-head__balance-label">{{ balanceLabel }}</span>
        </div>
      </header>

      <!-- ADR-0004: Wohin der Saldo fliesst, direkt sichtbar statt nur als Tag. -->
      <Message v-if="hasClosingDate" severity="info" class="closed-banner">
        <template v-if="isClosed">Geschlossen am {{ closingDateLabel }} – der Saldo fließt in</template>
        <template v-else>Schließt am {{ closingDateLabel }} in</template>
        <NuxtLink v-if="successor" :to="`/budgeting/budgets/${successor.id}`" class="closed-banner__link">
          „{{ successor.name }}“ <i class="pi pi-arrow-right" aria-hidden="true" />
        </NuxtLink>
        <template v-else>ein anderes Budget</template>
      </Message>

      <!-- Aktionen: Umbuchen fuer alle Mitglieder, der Rest Owner-only (#128) -->
      <div v-if="!isClosed || canManageHousehold" class="detail-actions">
        <Button
          v-if="!isClosed && savingsGoals.length > 0"
          label="Umbuchen"
          icon="pi pi-arrow-right-arrow-left"
          size="small"
          outlined
          @click="dialogs?.openTransfer(budget)"
        />
        <template v-if="canManageHousehold">
          <Button
            v-if="!hasClosingDate"
            label="Bearbeiten"
            icon="pi pi-pen-to-square"
            size="small"
            severity="secondary"
            outlined
            @click="dialogs?.openEdit(budget)"
          />
          <Button
            v-if="!hasClosingDate"
            label="Schließen"
            icon="pi pi-lock"
            size="small"
            severity="secondary"
            outlined
            @click="dialogs?.openClose(budget)"
          />
          <Button
            label="Löschen"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            text
            @click="dialogs?.remove(budget)"
          />
        </template>
      </div>

      <!-- Saldo-Verlauf, prominent -->
      <article class="panel">
        <div class="panel__head">
          <h2>Saldo-Verlauf</h2>
          <div class="ranges" role="group" aria-label="Zeitraum">
            <button
              v-for="range in RANGES"
              :key="range.months"
              type="button"
              class="ranges__item"
              :class="{ 'is-active': months === range.months }"
              :aria-pressed="months === range.months"
              @click="months = range.months"
            >
              {{ range.label }}
            </button>
          </div>
        </div>
        <div v-if="historyError" class="panel__error">
          <span>{{ historyError }}</span>
          <Button label="Erneut versuchen" icon="pi pi-refresh" size="small" text @click="loadHistory" />
        </div>
        <div v-else-if="!history" class="panel__placeholder">Lade Verlauf …</div>
        <template v-else>
          <BudgetBalanceChart
            :class="{ 'is-loading': historyLoading }"
            :points="history.points"
            :events="chartEvents"
            :range="{ from: history.from, to: history.to }"
            :format-money="formatMoney"
            :height="260"
          />
          <ul v-if="chartEvents.length > 0" class="legend" aria-hidden="true">
            <li class="legend__item legend__item--transfer">Umbuchung</li>
            <li class="legend__item legend__item--version">Neuer Betrag</li>
            <li class="legend__item legend__item--carryover">Übertrag</li>
          </ul>
          <p v-if="predecessorNames.length > 0" class="panel__note">
            Enthält den Verlauf von {{ predecessorNames.map((name) => `„${name}“`).join(', ') }} vor dem Übertrag.
          </p>
        </template>
      </article>

      <div class="detail-grid">
        <!-- Laufende Periode inkl. Forecast -->
        <article class="panel">
          <h2>Aktuelle Periode</h2>
          <template v-if="period">
            <p class="period-label">{{ formatBudgetPeriodLabel(budget.frequency, period.start, period.end) }}</p>
            <ListProgressBar
              :percent="period.percentUsed"
              :tone="period.severity"
              :label="`${formatMoney(period.spentAmount)} / ${formatMoney(period.plannedAmount)}`"
            />
            <dl class="facts">
              <div>
                <dt>Rest dieser Periode</dt>
                <dd :class="{ 'is-negative': period.remainingAmount < 0 }">{{ formatMoney(period.remainingAmount) }}</dd>
              </div>
              <div v-if="period.forecast">
                <dt>Prognose bis Periodenende</dt>
                <dd :class="`forecast--${period.forecast.severity}`">
                  {{ formatMoney(period.forecast.forecastTotal) }} ausgegeben,
                  Rest {{ formatMoney(period.forecast.forecastRemaining) }}
                </dd>
              </div>
            </dl>
            <NuxtLink v-if="periodTransactionsLink()" :to="periodTransactionsLink()!" class="text-link">
              Buchungen dieser Periode <i class="pi pi-arrow-right" aria-hidden="true" />
            </NuxtLink>
          </template>
          <p v-else class="panel__placeholder">
            {{ hasClosingDate ? 'Das Budget ist geschlossen — es gibt keine laufende Periode mehr.' : 'Noch keine gültige Version — die erste Zuteilung liegt in der Zukunft.' }}
          </p>
        </article>

        <!-- Versionen (Betragsaenderungen) + verknuepfte Vorgaenger/Nachfolger -->
        <article class="panel">
          <h2>Beträge</h2>
          <ul class="versions">
            <li v-for="version in budget.versions" :key="version.id">
              <span>ab {{ formatPlanningDate(version.validFrom) }}</span>
              <span class="versions__amount">{{ formatMoney(version.amount) }} / {{ frequencyLabel(budget.frequency) }}</span>
            </li>
          </ul>
          <h3 v-if="successor || predecessors.length > 0">Verknüpfte Budgets</h3>
          <ul v-if="successor || predecessors.length > 0" class="links">
            <li v-if="successor">
              <i class="pi pi-arrow-right" aria-hidden="true" />
              Saldo fließt ab {{ formatPlanningDate(budget.closedAt) }} in
              <NuxtLink :to="`/budgeting/budgets/${successor.id}`">{{ successor.name }}</NuxtLink>
            </li>
            <li v-for="predecessor in predecessors" :key="predecessor.id">
              <i class="pi pi-arrow-left" aria-hidden="true" />
              Übertrag aus
              <NuxtLink :to="`/budgeting/budgets/${predecessor.id}`">{{ predecessor.name }}</NuxtLink>
              (geschlossen zum {{ formatPlanningDate(predecessor.closedAt) }})
            </li>
          </ul>
        </article>
      </div>

      <!-- Ereignisliste -->
      <article class="panel">
        <h2>Saldo-Ereignisse</h2>
        <p v-if="history && entries.length === 0" class="panel__placeholder">Keine Bewegungen im gewählten Zeitraum.</p>
        <ul v-else-if="history" class="entries">
          <li
            v-for="(entry, index) in entries"
            :key="`${entry.type}-${entry.id ?? entry.date}-${index}`"
            class="entry"
            :class="`entry--${entry.type}`"
          >
            <span class="entry__date">{{ longDate(entry.date) }}</span>
            <i :class="ENTRY_ICONS[entry.type]" class="entry__icon" aria-hidden="true" />
            <span class="entry__text">
              <template v-if="entry.type === 'carryover' && entry.fromBudgetId">
                Übertrag aus
                <NuxtLink :to="`/budgeting/budgets/${entry.fromBudgetId}`">{{ entry.fromBudgetName ?? 'Vorgänger' }}</NuxtLink>
              </template>
              <template v-else>{{ entryTitle(entry) }}</template>
              <span v-if="entry.type === 'transfer' && entry.text" class="entry__note">{{ entry.text }}</span>
              <span v-if="chainSuffix(entry)" class="entry__note">{{ chainSuffix(entry).trim() }}</span>
            </span>
            <span class="entry__amount" :class="{ 'is-negative': entry.amount < 0 }">
              {{ entry.amount > 0 ? '+' : '' }}{{ formatMoney(entry.amount) }}
            </span>
          </li>
        </ul>
      </article>

      <BudgetActionDialogs
        v-if="householdId"
        ref="dialogs"
        :household-id="householdId"
        :budgets="budgets"
        :savings-goals="savingsGoals"
        :currency="currencyCode"
        @changed="reload"
        @notice="notice = $event"
        @deleted="onDeleted"
      />
    </template>
  </section>
</template>

<style scoped>
.budget-detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
}

.back-link:hover {
  color: var(--color-accent-primary-text);
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.detail-head__title {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.detail-head h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.detail-head__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  padding: 1px 7px;
  background: rgba(59, 130, 246, 0.16);
  color: var(--color-accent-primary-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.tag--closed {
  background: rgba(148, 163, 184, 0.16);
  color: var(--color-text-secondary);
  text-transform: none;
  letter-spacing: 0;
}

.detail-head__balance {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.detail-head__balance-value {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--color-accent-success-text);
  font-variant-numeric: tabular-nums;
}

.detail-head__balance-value.is-negative {
  color: var(--color-accent-danger-text);
}

.detail-head__balance-value.is-closed {
  color: var(--color-text-secondary);
}

.closed-banner__link {
  color: inherit;
  font-weight: 700;
  white-space: nowrap;
}

.closed-banner__link .pi {
  font-size: 0.7rem;
}

.detail-head__balance-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg, 12px);
  min-width: 0;
}

.panel h2 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.panel h3 {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.panel__placeholder,
.panel__note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.82rem;
}

.panel__error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  color: var(--color-accent-danger-text);
  font-size: 0.82rem;
}

.ranges {
  display: inline-flex;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.ranges__item {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  cursor: pointer;
}

.ranges__item + .ranges__item {
  border-left: 1px solid var(--color-border-default);
}

.ranges__item.is-active {
  background: var(--color-accent-primary);
  color: #fff;
}

.ranges__item:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

/* Farbpunkt = gleiche Farbe wie der Marker im Chart */
.legend__item::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend__item--transfer::before {
  background: var(--color-accent-warning);
}

.legend__item--version::before {
  background: var(--color-accent-primary);
}

.legend__item--carryover::before {
  background: var(--color-accent-success);
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

@media (min-width: 900px) {
  .detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.period-label {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.82rem;
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.facts dt {
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.facts dd.is-negative,
.forecast--over {
  color: var(--color-accent-danger-text) !important;
}

.forecast--warning {
  color: var(--color-accent-warning-text) !important;
}

.text-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-accent-primary-text);
  text-decoration: none;
}

.text-link .pi {
  font-size: 0.7rem;
}

.links,
.versions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.links .pi {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-right: 0.25rem;
}

.links a,
.entry__text a {
  color: var(--color-accent-primary-text);
  font-weight: 600;
}

.versions li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.versions__amount {
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.entry {
  display: grid;
  grid-template-columns: 5.6rem 1rem minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.45rem 0;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 0.84rem;
}

.entry:first-child {
  border-top: 0;
}

.entry__date {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
}

.entry__icon {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.entry--transfer .entry__icon {
  color: var(--color-accent-warning-text);
}

.entry--carryover .entry__icon {
  color: var(--color-accent-success-text);
}

.entry--allocation .entry__icon {
  color: var(--color-accent-primary-text);
}

.entry__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.entry__note {
  font-size: 0.74rem;
  color: var(--color-text-muted);
}

.entry__amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-success-text);
  white-space: nowrap;
}

.entry__amount.is-negative {
  color: var(--color-text-primary);
}

@media (max-width: 639px) {
  .detail-head__balance {
    align-items: flex-start;
  }

  .entry {
    grid-template-columns: 1rem minmax(0, 1fr) auto;
  }

  /* Datum mobil ueber dem Text statt eigener Spalte */
  .entry__date {
    grid-column: 2 / 4;
    grid-row: 1;
  }

  .entry__icon {
    grid-column: 1;
    grid-row: 2;
  }

  .entry__text {
    grid-column: 2;
    grid-row: 2;
  }

  .entry__amount {
    grid-column: 3;
    grid-row: 2;
  }
}
</style>
