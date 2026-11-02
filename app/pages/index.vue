<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { EnvelopeItem, UnassignedOverview } from '~/types/envelope'

definePageMeta({ layout: 'default' })

type DashboardData = {
  householdId: string
  monthSummary: {
    income: number
    expenses: number
    balance: number
    unassignedExpenses: number
  }
  // ADR-0005: Umschlaege mit Saldo, Periode und Bewertung nach Saldo.
  envelopes: EnvelopeItem[]
  unassigned: UnassignedOverview
  recentActivity: Array<{
    id: string
    kind: 'expense' | 'income'
    amount: number
    description: string | null
    date: string
    envelopeName: string | null
    userDisplayName: string | null
  }>
  // Issue #98: fällige, noch nicht (voll) gedeckte Recurring-Pläne
  // diesen Monat — Zähler für den „Handlungsbedarf"-Block.
  recurringDue?: {
    fixedCostsOpen: number
    fixedCostsDue: number
    incomeOpen: number
    incomeDue: number
  }
}

const { activeHousehold, canManageHousehold } = useHousehold()
const snapshot = ref<DashboardData | null>(null)
// SSR-Initial-Render-Fix: `loading` startet auf `true`, damit EmptyState
// beim ersten Render den Spinner zeigt, BEVOR `loadDashboard` in onMounted
// die Daten geladen hat. Vorher startete `loading` auf `false`, was im
// SSR zu einem leeren EmptyState-Render fuehrte (keine loading/noHousehold/
// variant/slot-Bedingung griff → leere Kommentare), und der User sah
// eine leere Page bis zur Client-Hydration.
const loading = ref(true)
const errorMessage = ref<string | null>(null)

const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)
const formatMoney = (cents: number | null | undefined) =>
  moneyFormatter.value.format((cents ?? 0) / 100)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()),
)

const summary = computed(() => snapshot.value?.monthSummary ?? null)
const envelopes = computed(() => snapshot.value?.envelopes ?? [])
const unassigned = computed(() => snapshot.value?.unassigned ?? { balance: 0, reserved: 0, free: 0 })
const isOpen = (envelope: EnvelopeItem) => !envelope.closedAt || new Date(envelope.closedAt) > new Date()
// Karten: alle offenen laufenden Ausgaben mit Periode.
const runningEnvelopes = computed(() =>
  envelopes.value.filter((envelope) => envelope.group === 'RUNNING' && envelope.currentPeriod && isOpen(envelope)),
)
// Sparziele: alles Offene mit Zielbetrag, unabhaengig von der Gruppe. `monthlyRate`
// nur bei monatlicher Zuteilung — sonst waere die Angabe "/ Monat" falsch.
const savingsGoals = computed(() =>
  envelopes.value
    .filter((envelope) => envelope.targetAmount !== null && isOpen(envelope))
    .map((envelope) => ({
      id: envelope.id,
      name: envelope.name,
      targetAmount: envelope.targetAmount!,
      currentAmount: envelope.balance.balance,
      monthlyRate: envelope.frequency === 'MONTHLY' ? envelope.allocationAmount ?? 0 : 0,
      percentToTarget: envelope.targetAmount! > 0 ? Math.max(0, envelope.balance.balance / envelope.targetAmount!) * 100 : 0,
    }))
    .sort((left, right) => right.percentToTarget - left.percentToTarget),
)
const recentActivity = computed(() => snapshot.value?.recentActivity ?? [])
// Issue #97: der Schnellzugriff auf die letzte Buchung ist aus dem
// "Handlungsbedarf"-Block in den "Letzte Buchungen"-Panel-Header gewandert.
const latestEntry = computed(() => recentActivity.value[0] ?? null)

// Issue #97: Dashboard-Listen zeigen nur die Spitze — die volle Liste
// liegt je eine Seite tiefer, verlinkt ueber "Alle anzeigen".
const DASHBOARD_LIST_LIMIT = 3

const balanceTone = computed(() => ((summary.value?.balance ?? 0) >= 0 ? 'primary' : 'danger'))
// Issue #101: Einnahmen bei 0 € im Monatsstreifen gedaempft statt gruen.
const incomeIsZero = computed(() => (summary.value?.income ?? 0) === 0)

async function loadDashboard() {
  if (!activeHousehold.value) {
    snapshot.value = null
    errorMessage.value = null
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    const data = await $fetch<DashboardData>(
      `/api/households/${activeHousehold.value.id}/dashboard`,
      { headers },
    )
    snapshot.value = data
  } catch (err: any) {
    errorMessage.value =
      err.statusMessage || err.message || 'Dashboard konnte nicht geladen werden.'
    snapshot.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDashboard)
watch(() => activeHousehold.value?.id, loadDashboard)

// Issue #91: der globale Erfassen-Dialog kann von hier aus eine Buchung
// anlegen — dann die Dashboard-Kennzahlen neu holen.
const quickCapture = useQuickCapture()
watch(quickCapture.savedTick, loadDashboard)
</script>

<template>
  <section class="dashboard-page">
    <!-- Kein sichtbarer Seitentitel mehr: die Navigation benennt die Seite,
         und die Begrueßung ("Hallo, Jan") plus der Erklaersatz kosteten ~300px
         toten Raum ueber dem ersten handlungsrelevanten Element. Die <h1>
         bleibt fuer Screenreader / Dokumentstruktur erhalten. -->
    <h1 class="sr-only">Dashboard — finanzieller Überblick für {{ monthLabel }}</h1>

    <EmptyState
      v-if="!activeHousehold"
      :no-household="true"
      no-household-title="Wähle einen Haushalt aus dem Menü"
      no-household-text="Damit wir dein Dashboard mit echten Daten füllen können."
    />

    <EmptyState
      v-else-if="loading && !snapshot"
      :loading="true"
      loading-title="Dashboard wird geladen"
      loading-text="Wir holen die aktuellen Zahlen aus der Datenbank."
    />

    <Message v-else-if="errorMessage" severity="error" :closable="false" class="mb-6">
      Dashboard konnte nicht geladen werden: {{ errorMessage }}
    </Message>

    <template v-else-if="snapshot">
      <!-- Karten der laufenden Ausgaben: oberste Prio auf dem Dashboard. Jede
           Karte bezieht sich auf die eigene, aktuell laufende Periode des
           Budgets (Woche/Monat/Quartal/Jahr/einmalig) statt auf den
           Kalendermonat — ersetzt die alte, kalendermonats-skalierte
           "Budget-Auslastung"-Liste (DashboardBudgetList). -->
      <ListPanel title="Laufende Ausgaben" :compact="true" :no-bleed="true">
        <template #actions>
          <NuxtLink to="/budgeting/envelopes">
            <Button
              icon="pi pi-external-link"
              size="small"
              severity="secondary"
              outlined
              text
              aria-label="Alle Umschläge anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardEnvelopeGrid :envelopes="runningEnvelopes" :format-money="formatMoney" />
      </ListPanel>

      <!-- Handlungsbedarf (issue #37): stand urspruenglich ganz oben, weil
           die Alltagsfrage "Was muss ich mir ansehen?" wichtiger war als
           "Wie hoch waren meine Einnahmen?" — steht jetzt direkt unter den
           Budget-Perioden-Karten (neue oberste Prio). Issue #97: zeigt nur echten
           Handlungsbedarf (kritische Budgets, unzugeordnete Buchungen,
           fällige wiederkehrende Posten) + das freie Restbudget — sonst
           einen ruhigen Einzeiler. -->
      <DashboardActionRequired
        :envelopes="envelopes"
        :unassigned-expenses="summary?.unassignedExpenses ?? 0"
        :unassigned-free="unassigned.free"
        :recurring-due="snapshot.recurringDue ?? null"
        :format-money="formatMoney"
      />

      <!-- ADR-0005: "Wie viel kann ich noch verteilen?" zwischen Handlungsbedarf
           und Monatszeile. Loest die Liquiditaets-Karte aus issue #57 ab. -->
      <DashboardUnassignedCard :unassigned="unassigned" :format-money="formatMoney" />

      <!-- Kompakte Monatszeile (issue #37): Der Saldo ist die Leitzahl,
           Einnahmen/Ausgaben stehen sekundaer daneben. -->
      <div class="month-strip" :class="`month-strip--${balanceTone}`" role="group" aria-label="Monatsübersicht">
        <div class="month-strip__primary">
          <span class="month-strip__label">Saldo · {{ monthLabel }}</span>
          <span class="month-strip__balance">{{ formatMoney(summary?.balance) }}</span>
        </div>
        <dl class="month-strip__aside">
          <!-- Issue #101: Ausgaben sind das taegliche Signal und stehen vorn.
               Einnahmen (~1x im Monat) bleiben immer sichtbar — kein Layout-
               Sprung beim ersten Gehaltseingang —, sind aber bei 0 € gedaempft
               statt gruen. -->
          <div class="month-strip__pair">
            <dt>Ausgaben</dt>
            <dd class="month-strip__neg">{{ formatMoney(summary?.expenses) }}</dd>
          </div>
          <div class="month-strip__pair">
            <dt>Einnahmen</dt>
            <dd :class="incomeIsZero ? 'month-strip__muted' : 'month-strip__pos'">{{ formatMoney(summary?.income) }}</dd>
          </div>
        </dl>
      </div>

      <ListPanel title="Letzte Buchungen" :compact="true">
        <template v-if="latestEntry" #subtitle>
          <NuxtLink to="/transactions/expenses" class="panel-quicklink">
            Zuletzt: {{ latestEntry.description || (latestEntry.kind === 'income' ? 'Einnahme' : 'Ausgabe') }}
            · {{ latestEntry.kind === 'income' ? '+' : '−' }}{{ formatMoney(latestEntry.amount) }}
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </NuxtLink>
        </template>
        <template #actions>
          <!-- Issue #99: oeffnet den globalen Quick-Capture-Dialog direkt
               (statt nur auf die Listenseite zu verlinken) — konsistent
               mit "Sparziel anlegen" darunter. -->
          <Button label="Ausgabe erfassen" icon="pi pi-plus" size="small" severity="primary" @click="quickCapture.open('expense')" />
          <!-- Issue #53: Sekundaere "Alle anzeigen"-Action, die auf die
               volle Monatsliste der Ausgaben springt. Pattern-konsistent
               mit dem Budget- und Sparziele-Panel, deren sekundaere
               Action-Buttons ebenfalls `outlined` sind. Visuelle Hierarchie:
               der primaere "Ausgabe erfassen" (filled, primary) bleibt
               dominanter; "Alle anzeigen" daneben als Outline. -->
          <NuxtLink to="/transactions/expenses">
            <Button
              label="Alle anzeigen"
              icon="pi pi-list"
              size="small"
              severity="secondary"
              outlined
              aria-label="Alle Ausgaben anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardActivityList :activity="recentActivity" :limit="DASHBOARD_LIST_LIMIT" :format-money="formatMoney" />
      </ListPanel>

      <!-- Sparziele mit Fortschrittsbalken (issue #6 AC):
           pro Sparziel eigene Zeile mit Progressbar und
           currentAmount / targetAmount + monthlyRate. -->
      <ListPanel title="Sparziele" :compact="true">
        <template #actions>
          <!-- Sparziele anlegen ist Owner-only (issue #128). Issue #99:
               ?new=1 oeffnet den Sparziel-Dialog direkt auf der Zielseite
               (useQueryTrigger in savings.vue) — gleicher Button-Style wie
               "Ausgabe erfassen" oben. -->
          <NuxtLink v-if="canManageHousehold" to="/budgeting/envelopes?group=SAVINGS&new=1">
            <Button label="Sparziel anlegen" icon="pi pi-plus" size="small" severity="primary" />
          </NuxtLink>
          <NuxtLink to="/budgeting/envelopes?group=SAVINGS">
            <Button
              label="Alle anzeigen"
              icon="pi pi-list"
              size="small"
              severity="secondary"
              outlined
              aria-label="Alle Sparziele anzeigen"
            />
          </NuxtLink>
        </template>
        <DashboardSavingsList :goals="savingsGoals" :limit="DASHBOARD_LIST_LIMIT" :format-money="formatMoney" />
      </ListPanel>
    </template>
  </section>
</template>

<style scoped>
/* Vertikaler Rhythmus der Dashboard-Sektionen — ersetzt das
   list-page-shell__content-Layout, das der Dashboard-Wrapper vorher lieferte. */
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Issue #97: Schnellzugriff auf die letzte Buchung im Panel-Header. */
.panel-quicklink {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted, #94a3b8);
  text-decoration: none;
}

.panel-quicklink:hover {
  color: var(--color-accent-primary-text, #93c5fd);
}

.panel-quicklink .pi {
  font-size: 0.7rem;
}

/* === Kompakte Monatszeile (issue #37) === */
.month-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  flex-wrap: wrap;
  padding: 0.8rem 1.1rem;
  margin-bottom: 1.25rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: 14px;
  font-variant-numeric: tabular-nums;
}

.month-strip__label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
  white-space: nowrap;
}

.month-strip__primary {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.month-strip__balance {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--color-text-primary, #f1f5f9);
}

.month-strip--primary .month-strip__balance {
  color: var(--color-accent-primary-text, #60a5fa);
}

.month-strip--danger .month-strip__balance {
  color: var(--color-accent-danger-text, #f87171);
}

.month-strip__aside {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  margin: 0;
  flex-wrap: wrap;
}

.month-strip__pair {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.month-strip__pair dt {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
}

.month-strip__pair dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-secondary, #cbd5e1);
  white-space: nowrap;
}

.month-strip__aside dd.month-strip__pos {
  color: var(--color-accent-success-text, #34d399);
}

.month-strip__aside dd.month-strip__neg {
  color: var(--color-accent-danger-text, #f87171);
}

/* Issue #101: Einnahmen ohne Betrag (die meiste Zeit des Monats) nicht
   prominent gruen, sondern gedaempft. */
.month-strip__aside dd.month-strip__muted {
  color: var(--color-text-muted, #94a3b8);
}

@media (max-width: 640px) {
  .month-strip {
    gap: 0.75rem 1.25rem;
    padding: 0.8rem 0.95rem;
  }
  .month-strip__aside {
    width: 100%;
    gap: 1rem 1.75rem;
  }
}
</style>
