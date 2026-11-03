<!--
  Umschlag-Detailseite (ADR-0005): ein Umschlag als virtuelles Konto.

  Der Kopf beantwortet ohne Scrollen (375 px) "wie viel ist da, wohin geht
  der Trend?": Saldo gross, Veraenderung im gewaehlten Zeitraum und eine kompakte Leiste der laufenden Periode. Darunter
  das Diagramm, Umbuchen als einzige Primaeraktion, die nach Periode
  gruppierte Ereignisliste und (mobil einklappbar) Betraege und verknuepfte
  Vorgaenger/Nachfolger. Seltene Owner-Aktionen stecken im "⋯"-Menue.

  Der aktive Haushalt kommt wie ueberall aus useHousehold; eine ID, die es
  im Haushalt nicht gibt (unbekannt, fremd oder kein UUID), zeigt eine
  eigene Nicht-gefunden-Ansicht statt eines leeren Skeletts.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Menu from 'primevue/menu'
import type { Notice } from '~/types/planning'
import type { EnvelopeHistoryEntry, EnvelopeHistoryResponse, EnvelopeItem } from '~/types/envelope'
import type { BalanceChartEvent } from '~/components/EnvelopeBalanceChart.vue'
import { compactMoneyLabel } from '~/utils/balance-chart'
import { ENVELOPE_GROUPS } from '~/utils/envelope-options'
import {
  allHistoryFrom,
  balanceTrendOf,
  groupEntriesByPeriod,
  periodStartDay,
  trendVersusPreviousPeriod,
} from '~/utils/envelope-detail'

definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const { activeHousehold, canManageHousehold, fetchHouseholds } = useHousehold()
const reducedMotion = useReducedMotion()

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Obergrenze des Servers fuer den Verlauf (MAX_HISTORY_RANGE_DAYS). */
const MAX_HISTORY_DAYS = 2 * 366

const envelopeId = computed(() => String(route.params.id ?? ''))
const householdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')
const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)
/** Ohne ",00" — fuer kurze Zeilen (Kopf, Gruppen), wo jede Stelle zaehlt. */
const compactMoney = (value: number) => compactMoneyLabel(formatMoney(value))
/** Betrag mit echtem Minuszeichen bzw. Plus — Vorzeichen ist hier die Aussage. */
const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${compactMoney(Math.abs(value))}`

const envelopes = ref<EnvelopeItem[]>([])
const loading = ref(true)
const loaded = ref(false)
// Ladefehler getrennt von "nicht gefunden": Bei Netz-/500-Fehlern darf die
// Seite nicht behaupten, der Umschlag gebe es nicht (mehr).
const loadError = ref<string | null>(null)
const notice = ref<Notice | null>(null)
const dialogs = ref<{
  openEdit: (envelope: EnvelopeItem) => void
  openClose: (envelope: EnvelopeItem) => void
  openTransfer: (envelope: EnvelopeItem, preset?: { direction: 'out' | 'in'; amountCents: number }) => void
  remove: (envelope: EnvelopeItem) => Promise<void>
} | null>(null)

const envelopesById = computed(() => new Map(envelopes.value.map((envelope) => [envelope.id, envelope] as const)))
const envelope = computed(() => envelopesById.value.get(envelopeId.value) ?? null)
// Nicht gefunden nur bei ungueltiger ID oder wenn das Laden geklappt hat
// und der Umschlag im Haushalt fehlt — nie nach einem Ladefehler.
const notFound = computed(() =>
  !UUID_PATTERN.test(envelopeId.value) || (loaded.value && !loadError.value && !envelope.value),
)

const balance = computed(() => envelope.value?.balance.balance ?? 0)
const envelopeGroupLabel = computed(() => ENVELOPE_GROUPS.find((group) => group.value === envelope.value?.group)?.label ?? '')
const targetPercent = computed(() => {
  const target = envelope.value?.targetAmount
  return target ? Math.max(0, balance.value / target) * 100 : null
})
const isClosed = computed(() => Boolean(envelope.value && !isEnvelopeOpenOn(envelope.value)))
const hasClosingDate = computed(() => Boolean(envelope.value?.closedAt))
const successor = computed(() =>
  envelope.value?.carryoverToEnvelopeId ? envelopesById.value.get(envelope.value.carryoverToEnvelopeId) ?? null : null,
)
// Geschlossen: Der Endsaldo steckt laut ADR-0004 bereits im Ziel.
// Deshalb neutral statt gruen/rot — sonst wirkt er wie verfuegbares Geld.
const balanceLabel = computed(() => (isClosed.value ? 'Endsaldo' : 'Saldo'))
const closingDateLabel = computed(() => formatPlanningDate(envelope.value?.closedAt ?? null))
const predecessors = computed(() => envelopes.value.filter((item) => item.carryoverToEnvelopeId === envelopeId.value))
const period = computed(() => (isClosed.value ? null : envelope.value?.currentPeriod ?? null))
// Ueberzogen nur bei offenen Umschlaegen: ein geschlossener hat seinen
// (auch negativen) Endsaldo schon ans Ziel weitergegeben.
const overdrawn = computed(() => !isClosed.value && balance.value < 0)

async function loadEnvelopes() {
  if (!householdId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null
  try {
    // Alle Umschlaege statt eines Einzel-Endpoints: Die Seite braucht ohnehin
    // Namen fuer Vorgaenger/Nachfolger und die Ziel-Auswahl beim Schliessen.
    const data = await $fetch<{ envelopes: EnvelopeItem[] }>(`/api/households/${householdId.value}/envelopes`)
    envelopes.value = data.envelopes
    loaded.value = true
  } catch (error: any) {
    loadError.value = error.statusMessage || error.message || 'Unbekannter Fehler'
    // Schlaegt ein Neuladen nach einer Aktion fehl, bleibt die bisherige
    // Ansicht stehen und der Fehler kommt als Hinweis darueber.
    if (envelope.value) {
      notice.value = { severity: 'error', text: 'Umschlag konnte nicht neu geladen werden: ' + loadError.value }
    }
  } finally {
    loading.value = false
  }
}

// === Saldo-Verlauf =====================================================
// months: 0 = "Alles" (ab dem fruehesten Saldo-Start der Kette).
const RANGES = [
  { months: 1, label: '1 M' },
  { months: 3, label: '3 M' },
  { months: 6, label: '6 M' },
  { months: 12, label: '12 M' },
  { months: 0, label: 'Alles' },
] as const
// Default 3 Monate (abgestimmt): lang genug fuer ein paar Monatsperioden,
// kurz genug, dass Wochenstufen noch erkennbar sind.
const months = ref<number>(3)
const history = ref<EnvelopeHistoryResponse | null>(null)
const historyLoading = ref(false)
const historyError = ref<string | null>(null)

function historyFrom(to: Date): string {
  if (months.value === 0) {
    // Ohne geladene Umschlag-Liste (erster Aufruf laeuft parallel) kennt die
    // Seite balanceSince noch nicht — dann das Server-Maximum.
    return allHistoryFrom(envelopeId.value, envelopes.value, formatDateToInputString(to), MAX_HISTORY_DAYS)
  }
  const from = new Date(to)
  from.setMonth(from.getMonth() - months.value)
  return formatDateToInputString(from)
}

async function loadHistory() {
  if (!householdId.value || !UUID_PATTERN.test(envelopeId.value)) return
  historyLoading.value = true
  historyError.value = null
  const to = new Date()
  try {
    history.value = await $fetch<EnvelopeHistoryResponse>(
      `/api/households/${householdId.value}/envelopes/${envelopeId.value}/history`,
      { query: { from: historyFrom(to), to: formatDateToInputString(to) } },
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
  await Promise.all([loadEnvelopes(), loadHistory()])
}

onMounted(async () => {
  await fetchHouseholds()
  await reload()
})
watch(householdId, reload)
// Vorgaenger/Nachfolger-Links bleiben in derselben Komponente — bei neuer
// ID alles neu laden statt veraltete Daten zu zeigen.
watch(envelopeId, () => {
  history.value = null
  notice.value = null
  reload()
})
watch(months, loadHistory)

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${day}.${month}.`
}

/** Fremden Umschlag der Kette dazuschreiben — sonst ist "Zuteilung" mehrdeutig. */
function chainSuffix(item: { envelopeId: string; envelopeName: string | null }) {
  return item.envelopeId === envelopeId.value || !item.envelopeName ? '' : ` (${item.envelopeName})`
}

// Trendzeile nur mit eigener Information: offene Umschläge gegenueber dem Ende
// der Vorperiode. Ohne laufende Periode (geschlossen) die Veraenderung im
// Zeitraum — aber nicht, wenn der Zeitraum bei 0 beginnt, dann waere sie
// nur der Saldo noch einmal.
const trend = computed<{ delta: number; text: string } | null>(() => {
  const points = history.value?.points ?? []
  if (period.value && envelope.value) {
    const previous = trendVersusPreviousPeriod(points, period.value.start, envelope.value.frequency)
    return previous ? { delta: previous.delta, text: previous.label } : null
  }
  const range = balanceTrendOf(points)
  if (!range || points[0]?.balance === 0) return null
  return { delta: range.delta, text: `seit ${shortDate(range.since)}` }
})
const rangeHeading = computed(() =>
  months.value === 0 ? 'gesamter Verlauf' : months.value === 1 ? 'letzter Monat' : `letzte ${months.value} Monate`,
)
// Umschlag ohne jede Bewegung: statt einer flachen Nulllinie mit
// Phantom-Achse ("0,25 €") ein Leerzustand.
const historyEmpty = computed(() =>
  Boolean(history.value && history.value.entries.length === 0 && history.value.points.every((point) => point.balance === 0)),
)

// Markierungen im Diagramm: Umbuchungen, Uebertraege und jede Zuteilung, die
// sich von der vorherigen unterscheidet (neuer Betrag).
const chartEvents = computed<BalanceChartEvent[]>(() => {
  const entries = [...(history.value?.entries ?? [])].sort((left, right) => left.date.localeCompare(right.date))
  const events: BalanceChartEvent[] = []
  let lastAllocation: number | null = null
  for (const entry of entries) {
    if (entry.type === 'allocation') {
      if (lastAllocation !== null && entry.amount !== lastAllocation) {
        events.push({ type: 'version', date: entry.date, label: `Neue Zuteilung ${formatMoney(entry.amount)}${chainSuffix(entry)}` })
      }
      lastAllocation = entry.amount
    } else if (entry.type === 'transfer') {
      events.push({ type: 'transfer', date: entry.date, label: `${entryTitle(entry)} ${signedMoney(entry.amount)}${chainSuffix(entry)}` })
    } else if (entry.type === 'carryover') {
      events.push({ type: 'carryover', date: entry.date, label: `${entryTitle(entry)} ${formatMoney(entry.amount)}` })
    }
  }
  return events
})

const predecessorNames = computed(() =>
  (history.value?.chain ?? []).filter((item) => item.id !== envelopeId.value).map((item) => item.name),
)

// === Ereignisliste, nach Budgetperiode gruppiert =========================
const ENTRY_ICONS: Record<EnvelopeHistoryEntry['type'], string> = {
  allocation: 'pi pi-plus-circle',
  income: 'pi pi-plus',
  expense: 'pi pi-shopping-cart',
  transfer: 'pi pi-arrow-right-arrow-left',
  carryover: 'pi pi-link',
}

function entryTitle(entry: EnvelopeHistoryEntry): string {
  const other = entry.counterpartName ?? 'Zu verteilen'
  switch (entry.type) {
    case 'allocation':
      return 'Zuteilung'
    case 'income':
      return entry.text || 'Einnahme'
    case 'expense':
      return entry.text || 'Ausgabe'
    case 'transfer':
      return entry.amount < 0 ? `Umbuchung nach „${other}“` : `Umbuchung aus „${other}“`
    case 'carryover':
      return `Übertrag aus „${entry.counterpartName ?? 'Vorgänger'}“`
  }
}

/** Buchungsliste eines Umschlags fuer eine Periode (`to` ist exklusiv). */
function periodExpensesLink(envelopeId: string, start: string, end: string | null) {
  return {
    path: '/transactions/expenses',
    query: { envelopeId: envelopeId, from: start, ...(end ? { to: end } : {}) },
  }
}

// Absprung pro Periode statt pro Buchung: einzelne Buchungen zu verlinken
// fuehrte nur auf eine Ein-Tages-Liste, gesucht ist meist der Zeitraum.
// Die Historie enthaelt auch Vorgaenger-Perioden (ADR-0004) — deren
// Buchungen haengen am Vorgaenger, also dessen envelopeId verwenden. Die
// Buchungsliste filtert nur auf einen Umschlag; mischt eine Periode mehrere,
// bleibt es beim aktuellen.
function groupExpensesLink(group: { start: string; end: string | null; entries: EnvelopeHistoryEntry[] }) {
  if (!envelope.value) return null
  const envelopeIds = new Set(group.entries.filter((entry) => entry.type === 'expense').map((entry) => entry.envelopeId))
  if (envelopeIds.size === 0) return null
  const [only] = envelopeIds
  return periodExpensesLink(envelopeIds.size === 1 && only ? only : envelope.value.id, group.start, group.end)
}

const groups = computed(() =>
  history.value && envelope.value
    ? groupEntriesByPeriod(history.value.entries, envelope.value.frequency, history.value.points)
    : [],
)

function groupLabel(group: { start: string; end: string | null }) {
  if (!envelope.value) return ''
  return formatEnvelopePeriodLabel(envelope.value.frequency, `${group.start}T12:00:00`, group.end ? `${group.end}T12:00:00` : null)
}

// Laufende Periode offen, aeltere zu — die aktuelle ist fast immer die
// gesuchte, die alten bleiben einen Tipp entfernt.
const openGroups = ref<Set<string>>(new Set())
watch(groups, (next) => {
  const current = envelope.value ? periodStartDay(formatDateToInputString(new Date()), envelope.value.frequency) : null
  const initial = next.find((group) => group.start === current) ?? next[0]
  openGroups.value = new Set(initial ? [initial.start] : [])
})

function toggleGroup(start: string) {
  const next = new Set(openGroups.value)
  if (next.has(start)) next.delete(start)
  else next.add(start)
  openGroups.value = next
}

// Tipp auf einen Diagramm-Punkt: Gruppe aufklappen, hinscrollen, kurz
// hervorheben. Ein Tag ohne eigene Zeile (nur Zuteilung) hebt den Kopf hervor.
const highlightDate = ref<string | null>(null)
const highlightGroup = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

async function onChartSelect(date: string) {
  const group = groups.value.find((item) => item.start <= date && (item.end === null || date < item.end))
  if (!group) return
  if (!openGroups.value.has(group.start)) toggleGroup(group.start)
  const hasRow = group.entries.some((entry) => entry.date === date)
  highlightDate.value = hasRow ? date : null
  highlightGroup.value = hasRow ? null : group.start
  await nextTick()
  const target = hasRow
    ? document.querySelector(`[data-entry-date="${date}"]`)
    : document.getElementById(`period-${group.start}`)
  target?.scrollIntoView({ block: 'center', behavior: reducedMotion.value ? 'auto' : 'smooth' })
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightDate.value = null
    highlightGroup.value = null
  }, 2400)
}

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
})

// === Aktionen ==========================================================
// Umbuchen ist eine Buchung (ADR-0005: auch MEMBER).
function openTransfer() {
  if (envelope.value) dialogs.value?.openTransfer(envelope.value)
}

function openBalanceFix() {
  if (envelope.value) dialogs.value?.openTransfer(envelope.value, { direction: 'in', amountCents: -balance.value })
}

const actionMenu = ref<InstanceType<typeof Menu> | null>(null)
const actionMenuId = useId()

function toggleActionMenu(event: Event) {
  actionMenu.value?.toggle(event)
}

// Owner-only (#128). Deaktivierte Eintraege bleiben sichtbar und sagen,
// warum — ein fehlender Eintrag liesse nur raten.
const actionItems = computed(() => {
  const current = envelope.value
  const ownerHint = canManageHousehold.value ? null : 'Nur für Haushalts-Owner'
  const closedHint = hasClosingDate.value ? 'Umschlag ist geschlossen' : null
  const deleteHint = ownerHint ?? (current?.hasBookings ? 'Hat Buchungen – nur Schließen möglich' : null)
  return [
    {
      label: 'Bearbeiten',
      icon: 'pi pi-pen-to-square',
      hint: ownerHint ?? closedHint,
      disabled: Boolean(ownerHint ?? closedHint),
      command: () => { if (current) dialogs.value?.openEdit(current) },
    },
    {
      label: 'Schließen',
      icon: 'pi pi-lock',
      hint: ownerHint ?? closedHint,
      disabled: Boolean(ownerHint ?? closedHint),
      command: () => { if (current) dialogs.value?.openClose(current) },
    },
    {
      label: 'Löschen',
      icon: 'pi pi-trash',
      danger: true,
      hint: deleteHint,
      disabled: Boolean(deleteHint),
      command: () => { if (current) dialogs.value?.remove(current) },
    },
  ]
})

const asideOpen = ref(false)

function periodTransactionsLink() {
  if (!envelope.value || !period.value) return null
  return periodExpensesLink(envelope.value.id, period.value.start, period.value.end)
}

// === Gebuchte Zuteilung aendern ==========================================
// Nur der OWNER, nur der Betrag; 0 setzt die Periode aus (ADR-0005, Regel 3).
const allocationEdit = ref<{ id: string; date: string; amount: number | null } | null>(null)
const allocationSaving = ref(false)
const allocationError = ref<string | null>(null)
const allocationDialogOpen = computed({
  get: () => allocationEdit.value !== null,
  set: (open) => { if (!open) allocationEdit.value = null },
})

function openAllocationEdit(entry: EnvelopeHistoryEntry) {
  allocationError.value = null
  allocationEdit.value = { id: entry.id!, date: entry.date, amount: entry.amount / 100 }
}

async function saveAllocation() {
  if (!allocationEdit.value || !householdId.value) return
  allocationSaving.value = true
  allocationError.value = null
  try {
    await $fetch(`/api/households/${householdId.value}/transfers/${allocationEdit.value.id}`, {
      method: 'PATCH',
      body: { amount: allocationEdit.value.amount ?? 0 },
    })
    allocationEdit.value = null
    await reload()
  } catch (error: any) {
    allocationError.value = 'Zuteilung konnte nicht geändert werden: ' + (error.statusMessage || error.message)
  } finally {
    allocationSaving.value = false
  }
}

function onDeleted(id: string) {
  if (id === envelopeId.value) router.push('/budgeting/envelopes')
}
</script>

<template>
  <section class="envelope-detail">
    <NuxtLink to="/budgeting/envelopes" class="back-link">
      <i class="pi pi-arrow-left" aria-hidden="true" />
      Alle Umschläge
    </NuxtLink>

    <EmptyState
      v-if="!notFound && !(loadError && !envelope)"
      :loading="loading && !envelope"
      :no-household="!loading && !activeHousehold"
      loading-title="Umschlag wird geladen"
      loading-text="Wir holen Saldo, Verlauf und Buchungen."
    />

    <EmptyState
      v-if="notFound && !loading"
      variant="no-data"
      icon="pi pi-question-circle"
      icon-tone="muted"
      headline="Umschlag nicht gefunden"
      description="Diesen Umschlag gibt es im aktiven Haushalt nicht (mehr). Vielleicht gehört er zu einem anderen Haushalt oder wurde gelöscht."
      :cta="{ label: 'Zur Umschlag-Liste', onClick: () => router.push('/budgeting/envelopes'), severity: 'primary' }"
    />

    <EmptyState
      v-if="loadError && !envelope && !loading && !notFound"
      variant="no-data"
      icon="pi pi-exclamation-triangle"
      icon-tone="warning"
      headline="Umschlag konnte nicht geladen werden"
      :description="`Bitte Verbindung prüfen und erneut versuchen. (${loadError})`"
      :cta="{ label: 'Erneut versuchen', onClick: loadEnvelopes, severity: 'primary' }"
    />

    <template v-if="envelope && !notFound">
      <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

      <!-- Kopf: Name + Menue, Saldo gross, Trend, laufende Periode -->
      <header class="detail-head">
        <div class="detail-head__top">
          <div class="detail-head__title">
            <h1>{{ envelope.name }}</h1>
            <div class="detail-head__tags">
              <span class="tag">{{ envelopeGroupLabel }}</span>
              <span v-if="envelope.allocationSource !== 'NONE'" class="tag">{{ frequencyLabel(envelope.frequency) }}</span>
              <span v-if="isClosed" class="tag tag--closed">geschlossen</span>
            </div>
          </div>
          <div class="detail-head__actions">
            <!-- Desktop: Umbuchen oben rechts im Kopf; mobil unter dem Diagramm -->
            <Button
              v-if="!isClosed"
              label="Umbuchen"
              icon="pi pi-arrow-right-arrow-left"
              class="primary-action__button primary-action--head"
              @click="openTransfer"
            />
            <Button
              icon="pi pi-ellipsis-h"
              text
              rounded
              severity="secondary"
              class="detail-head__more"
              aria-label="Weitere Aktionen"
              aria-haspopup="true"
              :aria-controls="actionMenuId"
              @click="toggleActionMenu"
            />
            <Menu :id="actionMenuId" ref="actionMenu" :model="actionItems" popup>
              <template #item="{ item, props: itemProps }">
                <a v-bind="itemProps.action" class="action-menu__item" :class="{ 'action-menu__item--danger': item.danger && !item.disabled }">
                  <i :class="item.icon" aria-hidden="true" />
                  <span class="action-menu__text">
                    <span>{{ item.label }}</span>
                    <small v-if="item.hint" class="action-menu__hint">{{ item.hint }}</small>
                  </span>
                </a>
              </template>
            </Menu>
          </div>
        </div>
        <div class="detail-head__balance">
          <span class="detail-head__balance-label">{{ balanceLabel }}</span>
          <span
            class="detail-head__balance-value"
            :class="{ 'is-negative': overdrawn, 'is-closed': isClosed }"
          >{{ formatMoney(balance) }}</span>
          <span v-if="trend" class="detail-head__trend" :class="{ 'is-up': trend.delta > 0, 'is-down': trend.delta < 0 }">
            <span aria-hidden="true">{{ trend.delta > 0 ? '▲' : trend.delta < 0 ? '▼' : '■' }}</span>
            <span class="sr-only">{{ trend.delta > 0 ? 'gestiegen um' : trend.delta < 0 ? 'gesunken um' : 'unverändert' }}</span>
            {{ signedMoney(trend.delta) }} {{ trend.text }}
          </span>
          <span v-else-if="historyLoading" class="skeleton skeleton--line" aria-hidden="true" />
        </div>

        <p v-if="overdrawn" class="detail-head__overdrawn">
          <i class="pi pi-exclamation-circle" aria-hidden="true" />
          <!-- Betrag steht gross im Saldo — hier nur fuer Screenreader wiederholt -->
          <span>Überzogen<span class="sr-only"> um {{ formatMoney(-balance) }}</span></span>
          <span aria-hidden="true">·</span>
          <button type="button" class="link-button" @click="openBalanceFix">
            Ausgleichen
          </button>
        </p>

        <div v-if="targetPercent !== null && !isClosed" class="period-strip">
          <div class="period-strip__row">
            <span class="period-strip__label">Sparziel</span>
          </div>
          <ListProgressBar
            :percent="Math.min(100, targetPercent)"
            :tone="targetPercent >= 100 ? 'ok' : 'accent'"
            :label="`${compactMoney(balance)} von ${compactMoney(envelope.targetAmount ?? 0)}`"
          />
        </div>

        <div v-if="period" class="period-strip">
          <div class="period-strip__row">
            <span class="period-strip__label">{{ formatEnvelopePeriodLabel(envelope.frequency, period.start, period.end) }}</span>
          </div>
          <ListProgressBar
            v-if="envelope.group === 'RUNNING'"
            :percent="period.percentUsed"
            :tone="envelope.severity"
            :label="`${compactMoney(period.spent)} von ${compactMoney(period.available)} verfügbar`"
          />
          <p class="period-strip__info">
            {{ compactMoney(period.allocation) }} zugeteilt<template v-if="envelope.reserved > 0"> · +{{ compactMoney(envelope.reserved) }} kommen bis Monatsende</template>
          </p>
          <NuxtLink v-if="periodTransactionsLink()" :to="periodTransactionsLink()!" class="text-link">
            Buchungen dieser Periode <i class="pi pi-arrow-right" aria-hidden="true" />
          </NuxtLink>
        </div>
      </header>

      <!-- ADR-0004: Wohin der Saldo fliesst, direkt sichtbar statt nur als Tag. -->
      <Message v-if="hasClosingDate" severity="info" class="closed-banner">
        <template v-if="isClosed">Geschlossen am {{ closingDateLabel }} – der Saldo fließt in</template>
        <template v-else>Schließt am {{ closingDateLabel }} in</template>
        <NuxtLink v-if="successor" :to="`/budgeting/envelopes/${successor.id}`" class="closed-banner__link">
          „{{ successor.name }}“ <i class="pi pi-arrow-right" aria-hidden="true" />
        </NuxtLink>
        <template v-else>„Zu verteilen“</template>
      </Message>

      <!-- Saldo-Verlauf -->
      <article class="panel" :aria-busy="historyLoading">
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
        <div v-else-if="!history" class="skeleton skeleton--chart" aria-hidden="true" />
        <div v-else-if="historyEmpty" class="chart-empty">
          <i class="pi pi-chart-line" aria-hidden="true" />
          <p>Noch keine Bewegung im gewählten Zeitraum – der Saldo steht bei {{ formatMoney(0) }}.</p>
          <button v-if="months !== 0" type="button" class="link-button" @click="months = 0">Ganzen Verlauf zeigen</button>
        </div>
        <template v-else>
          <EnvelopeBalanceChart
            :class="{ 'is-loading': historyLoading }"
            :points="history.points"
            :events="chartEvents"
            :range="{ from: history.from, to: history.to }"
            :frequency="envelope.frequency"
            :format-money="formatMoney"
            @select="onChartSelect"
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

      <!-- Einzige Primaeraktion: Umbuchen (fuer alle Mitglieder). Mobil
           unter dem Diagramm; ab 900 px steht sie stattdessen im Kopf. -->
      <div v-if="!isClosed" class="primary-action primary-action--body">
        <Button
          label="Umbuchen"
          icon="pi pi-arrow-right-arrow-left"
          class="primary-action__button"
          @click="openTransfer"
        />
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <!-- Ereignisliste, nach Budgetperiode gruppiert -->
          <article class="panel" :aria-busy="historyLoading">
            <h2>Saldo-Ereignisse · {{ rangeHeading }}</h2>
            <div v-if="!history && !historyError" class="skeleton-rows" aria-hidden="true">
              <span v-for="row in 3" :key="row" class="skeleton skeleton--row" />
            </div>
            <p v-else-if="history && groups.length === 0" class="panel__placeholder">Keine Bewegungen im gewählten Zeitraum.</p>
            <div v-else-if="history" class="periods">
              <section
                v-for="group in groups"
                :id="`period-${group.start}`"
                :key="group.start"
                class="period-group"
                :class="{ 'is-highlighted': highlightGroup === group.start }"
              >
                <div class="period-group__head-row">
                  <button
                    type="button"
                    class="period-group__head"
                    :aria-expanded="openGroups.has(group.start)"
                    :aria-controls="`period-${group.start}-list`"
                    @click="toggleGroup(group.start)"
                  >
                    <i class="pi pi-chevron-right period-group__chevron" aria-hidden="true" />
                    <span class="period-group__label">{{ groupLabel(group) }}</span>
                    <span class="period-group__sums">
                      <span v-if="group.inflow !== 0" class="is-positive">{{ signedMoney(group.inflow) }}</span>
                      <span v-if="group.outflow !== 0">{{ signedMoney(group.outflow) }}</span>
                      <span class="period-group__end" :class="{ 'is-negative': group.endBalance < 0 }">Ende {{ compactMoney(group.endBalance) }}</span>
                    </span>
                  </button>
                  <NuxtLink
                    v-if="groupExpensesLink(group)"
                    :to="groupExpensesLink(group)!"
                    class="period-group__link"
                    :aria-label="`Buchungen ${groupLabel(group)} anzeigen`"
                    :title="`Buchungen ${groupLabel(group)} anzeigen`"
                  >
                    <span class="period-group__link-text">Buchungen</span>
                    <i class="pi pi-arrow-right" aria-hidden="true" />
                  </NuxtLink>
                </div>
                <div v-show="openGroups.has(group.start)" :id="`period-${group.start}-list`">
                  <!-- Gebuchte Zuteilungen: einzeln aenderbar, 0 heisst ausgesetzt (ADR-0005). -->
                  <p v-for="entry in group.allocationEntries" :key="entry.id ?? entry.date" class="period-group__allocation">
                    {{ entry.amount === 0 ? 'Zuteilung ausgesetzt' : `Zuteilung ${compactMoney(entry.amount)}` }}{{ chainSuffix(entry) }}
                    <button
                      v-if="canManageHousehold && entry.id"
                      type="button"
                      class="link-button"
                      :aria-label="`Zuteilung vom ${shortDate(entry.date)} ändern`"
                      @click="openAllocationEdit(entry)"
                    >
                      ändern
                    </button>
                  </p>
                  <ul v-if="group.entries.length > 0" class="entries">
                    <li
                      v-for="(entry, index) in group.entries"
                      :key="`${entry.type}-${entry.id ?? entry.date}-${index}`"
                      class="entry"
                      :class="[`entry--${entry.type}`, { 'is-highlighted': highlightDate === entry.date }]"
                      :data-entry-date="index === group.entries.findIndex((item) => item.date === entry.date) ? entry.date : undefined"
                    >
                      <i :class="ENTRY_ICONS[entry.type]" class="entry__icon" aria-hidden="true" />
                      <span class="entry__text">
                        <span class="entry__title">
                          <span class="entry__date">{{ shortDate(entry.date) }}</span>
                          <template v-if="entry.type === 'carryover' && entry.counterpartId">
                            Übertrag aus
                            <NuxtLink :to="`/budgeting/envelopes/${entry.counterpartId}`">{{ entry.counterpartName ?? 'Vorgänger' }}</NuxtLink>
                          </template>
                          <template v-else>{{ entryTitle(entry) }}</template>
                        </span>
                        <span v-if="entry.type === 'transfer' && entry.text" class="entry__note">{{ entry.text }}</span>
                        <span v-if="chainSuffix(entry)" class="entry__note">{{ chainSuffix(entry).trim() }}</span>
                      </span>
                      <span class="entry__amount" :class="{ 'is-negative': entry.amount < 0 }">
                        {{ entry.amount > 0 ? '+' : '' }}{{ formatMoney(entry.amount) }}
                      </span>
                    </li>
                  </ul>
                  <p v-else class="period-group__empty">Keine Ausgaben oder Umbuchungen.</p>
                </div>
              </section>
            </div>
          </article>
        </div>

        <!-- Betraege + verknuepfte Umschläge: Desktop rechts, mobil unten und eingeklappt -->
        <aside class="detail-aside">
          <button
            type="button"
            class="aside-toggle"
            :aria-expanded="asideOpen"
            aria-controls="envelope-aside-body"
            @click="asideOpen = !asideOpen"
          >
            <span>Zuteilung{{ successor || predecessors.length > 0 ? ' & verknüpfte Umschläge' : '' }}</span>
            <i class="pi pi-chevron-down aside-toggle__chevron" aria-hidden="true" />
          </button>
          <article id="envelope-aside-body" class="panel aside-body" :class="{ 'is-open': asideOpen }">
            <h2>Zuteilung</h2>
            <p class="aside-allocation">
              <template v-if="envelope.allocationSource === 'FIXED'">{{ formatMoney(envelope.allocationAmount ?? 0) }} / {{ frequencyLabel(envelope.frequency) }}</template>
              <template v-else-if="envelope.allocationSource === 'PLANS'">Aus Fixkosten-Plänen, {{ frequencyLabel(envelope.frequency) }}</template>
              <template v-else>Keine regelmäßige Zuteilung</template>
            </p>
            <h3 v-if="successor || predecessors.length > 0">Verknüpfte Umschläge</h3>
            <ul v-if="successor || predecessors.length > 0" class="links">
              <li v-if="successor">
                <i class="pi pi-arrow-right" aria-hidden="true" />
                Saldo fließt ab {{ formatPlanningDate(envelope.closedAt) }} in
                <NuxtLink :to="`/budgeting/envelopes/${successor.id}`">{{ successor.name }}</NuxtLink>
              </li>
              <li v-for="predecessor in predecessors" :key="predecessor.id">
                <i class="pi pi-arrow-left" aria-hidden="true" />
                Übertrag aus
                <NuxtLink :to="`/budgeting/envelopes/${predecessor.id}`">{{ predecessor.name }}</NuxtLink>
                (geschlossen zum {{ formatPlanningDate(predecessor.closedAt) }})
              </li>
            </ul>
          </article>
        </aside>
      </div>

      <FormDialog
        v-model:visible="allocationDialogOpen"
        :header="`Zuteilung vom ${allocationEdit ? shortDate(allocationEdit.date) : ''} ändern`"
        submit-label="Speichern"
        :saving="allocationSaving"
        @save="saveAllocation"
        @cancel="allocationEdit = null"
      >
        <p class="allocation-hint">Mit 0 € setzt du diese Periode aus. Der Betrag kommt aus „Zu verteilen“.</p>
        <FormFieldRow v-if="allocationEdit" label="Betrag" html-for="allocation-amount">
          <MoneyInput id="allocation-amount" v-model="allocationEdit.amount" :currency="currencyCode" :min="0" />
        </FormFieldRow>
        <Message v-if="allocationError" severity="error" variant="simple">{{ allocationError }}</Message>
      </FormDialog>

      <EnvelopeActionDialogs
        v-if="householdId"
        ref="dialogs"
        :household-id="householdId"
        :envelopes="envelopes"
        :currency="currencyCode"
        @changed="reload"
        @notice="notice = $event"
        @deleted="onDeleted"
      />
    </template>
  </section>
</template>

<style scoped>
.envelope-detail {
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
  min-height: var(--touch-target-min);
  margin: -0.5rem 0;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
}

.back-link:hover {
  color: var(--color-accent-primary-text);
}

/* === Kopf ============================================================= */
.detail-head {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.detail-head__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
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

.detail-head__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Umbuchen gibt es zweimal im DOM: im Kopf (Desktop) und unter dem
   Diagramm (mobil). display:none nimmt die jeweils andere Instanz auch
   aus dem Accessibility-Tree. */
@media (max-width: 899px) {
  .primary-action--head {
    display: none !important;
  }
}

@media (min-width: 900px) {
  .primary-action--body {
    display: none !important;
  }
}

.detail-head__more {
  flex-shrink: 0;
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
}

.detail-head__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  padding: 1px 7px;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-text);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.tag--closed {
  background: var(--color-overlay-hover);
  color: var(--color-text-secondary);
  text-transform: none;
  letter-spacing: 0;
}

.detail-head__balance {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.detail-head__balance-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.detail-head__balance-value {
  font-size: 2.25rem;
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

.detail-head__trend {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.detail-head__trend.is-up {
  color: var(--color-accent-success-text);
}

.detail-head__trend.is-down {
  color: var(--color-accent-danger-text);
}

.detail-head__overdrawn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.6rem;
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-accent-danger-text);
}

.link-button {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-target-min);
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-accent-primary-text);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.link-button:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.period-strip {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.65rem 0.8rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.period-strip__info {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.period-strip__row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.82rem;
}

.period-strip__label {
  font-weight: 600;
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

/* === Menue ============================================================ */
.action-menu__item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  min-height: var(--touch-target-min);
  padding: 0.6rem 0.9rem;
  color: var(--color-text-primary);
  text-decoration: none;
  cursor: pointer;
}

.action-menu__item .pi {
  margin-top: 0.15rem;
}

.action-menu__item--danger {
  color: var(--color-accent-danger-text);
}

.action-menu__text {
  display: flex;
  flex-direction: column;
}

.action-menu__hint {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

/* === Layout =========================================================== */
.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.detail-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

@media (min-width: 900px) {
  .detail-layout {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    align-items: start;
  }
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ranges__item {
  min-height: var(--touch-target-min);
  min-width: var(--touch-target-min);
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0 0.6rem;
  cursor: pointer;
}

.ranges__item + .ranges__item {
  border-left: 1px solid var(--color-border-default);
}

.ranges__item.is-active {
  background: var(--color-accent-primary);
  color: var(--color-text-on-action);
}

.ranges__item:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

/* Skeletons in der Groesse dessen, was kommt — kein Springen beim Laden. */
.skeleton {
  display: block;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--color-overlay-subtle) 25%, var(--color-overlay-hover) 50%, var(--color-overlay-subtle) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

.skeleton--chart {
  height: 180px;
}

.skeleton--line {
  width: 9rem;
  height: 1.1rem;
}

.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton--row {
  height: 2.5rem;
}

@media (min-width: 640px) {
  .skeleton--chart {
    height: 240px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}

@keyframes skeleton-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

.chart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 140px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.chart-empty .pi {
  font-size: 1.5rem;
}

.chart-empty p {
  margin: 0;
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

.primary-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.primary-action__button {
  min-height: var(--touch-target-min);
}

.primary-action__hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.primary-action__hint a,
.links a,
.entry__text a {
  color: var(--color-accent-primary-text);
  font-weight: 600;
}

.text-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-accent-primary-text);
  text-decoration: none;
}

.text-link .pi {
  font-size: 0.7rem;
}

/* === Ereignisse ======================================================= */
.periods {
  display: flex;
  flex-direction: column;
}

.period-group {
  border-top: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  transition: background-color 0.3s ease;
}

.period-group:first-child {
  border-top: 0;
}

.period-group__head-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.period-group__link {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  padding: 0 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-accent-primary-text);
  text-decoration: none;
}

.period-group__link:hover {
  background: var(--color-accent-primary-soft);
}

.period-group__link .pi {
  font-size: 0.7rem;
}

/* Mobil nur der Pfeil — der Periodenkopf braucht die Breite fuer die Summen. */
@media (max-width: 639px) {
  .period-group__link-text {
    display: none;
  }
}

.period-group__head {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
  align-items: center;
  column-gap: 0.4rem;
  flex: 1;
  min-width: 0;
  min-height: var(--touch-target-min);
  padding: 0.4rem 0;
  border: 0;
  background: none;
  color: var(--color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.period-group__head:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.period-group__chevron {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
}

.period-group__head[aria-expanded='true'] .period-group__chevron {
  transform: rotate(90deg);
}

.period-group__label {
  font-size: 0.86rem;
  font-weight: 700;
}

.period-group__sums {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.6rem;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.period-group__sums > span + span::before {
  content: '·';
  margin-right: 0.6rem;
  color: var(--color-text-muted);
}

.period-group__sums .is-positive {
  color: var(--color-accent-success-text);
}

.period-group__end {
  font-weight: 700;
  color: var(--color-text-primary);
}

.period-group__end.is-negative {
  color: var(--color-accent-danger-text);
}

.period-group__allocation,
.period-group__empty {
  margin: 0 0 0.4rem 1.4rem;
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.entries {
  list-style: none;
  margin: 0 0 0.4rem;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.entry {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.45rem 0.25rem;
  border-top: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
  transition: background-color 0.3s ease;
}

.entry:first-child {
  border-top: 0;
}

.entry.is-highlighted,
.period-group.is-highlighted {
  background: var(--color-accent-primary-soft);
}

.entry__date {
  margin-right: 0.35rem;
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

/* === Seitenspalte ===================================================== */
.detail-aside {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.aside-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: var(--touch-target-min);
  padding: 0 1rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-bg-panel-soft);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.aside-toggle:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.aside-toggle__chevron {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
}

.aside-toggle[aria-expanded='true'] .aside-toggle__chevron {
  transform: rotate(180deg);
}

.aside-body:not(.is-open) {
  display: none;
}

@media (min-width: 900px) {
  .aside-toggle {
    display: none;
  }

  .aside-body:not(.is-open) {
    display: flex;
  }
}

.links,
.allocation-hint {
  margin: 0 0 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.aside-allocation {
  margin: 0;
  font-size: 0.85rem;
}


.links .pi {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-right: 0.25rem;
}



@media (max-width: 639px) {
  .panel__head {
    flex-direction: column;
    align-items: stretch;
  }

  .ranges__item {
    flex: 1;
  }

  .primary-action {
    align-items: stretch;
  }

  .primary-action__button {
    width: 100%;
  }
}
</style>
