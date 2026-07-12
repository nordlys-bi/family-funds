<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { isFirstRun } from '~/utils/household-age'
import { todayDateHelperText } from '~/utils/form-helpers'
import { useEmojiLookup } from '~/composables/useEmojiLookup'
import { useBookingDialog } from '~/composables/useBookingDialog'

const { lookupEmoji } = useEmojiLookup()

definePageMeta({ layout: 'default' })

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

type SavingsGoalItem = {
  id: string
  name: string
  targetAmount: number
  monthlyRate: number
  startDate: string
  endDate: string | null
  createdAt: string
  // Aggregation aus /api/households/current (issue #12). currentAmount in
  // Cent, progressPercent als Zahl mit 1 Nachkommastelle (z. B. 25.5).
  currentAmount?: number
  progressPercent?: number
  // Issue #56: monatliche Plan-vs-Ist-Breakdown, vom Backend
  // aggregiert (3 Monate, neueste zuerst). Pro Eintrag:
  //   { month: 'YYYY-MM', planned, actual, percentUsed }
  // Bei monthlyRate <= 0 ist percentUsed immer 0 — das Frontend blendet
  // die Prozent-Anzeige in dem Fall aus.
  monthlyProgress?: Array<{
    month: string
    planned: number
    actual: number
    percentUsed: number
  }>
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  savingsGoals: SavingsGoalItem[]
}

type Notice = { severity: 'success' | 'warn' | 'error'; text: string }
type DateFormValue = Date | null

const { activeHousehold, fetchHouseholds } = useHousehold()
const confirm = useAskConfirm()

const currentHousehold = ref<PlanningHousehold | null>(null)
const loading = ref(false)
const notice = ref<Notice | null>(null)
const savingsLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const savingsDialogOpen = ref(false)

// History-Dialog-State (issue #39). `historyDialogOpen` steuert den
// `SavingsHistoryDialog`, `historyGoalId` ist die ID des Ziels, dessen
// Bewegungen gezeigt werden. Der Dialog laedt seine Daten selbst
// (ueber `useSavingsExecutionHistory`); wir geben ihm nur Goal + HH-ID.
const historyDialogOpen = ref(false)
const historyGoalId = ref<string | null>(null)
const historyGoal = computed(() => {
  if (!historyGoalId.value) return null
  return currentHousehold.value?.savingsGoals.find((g) => g.id === historyGoalId.value) ?? null
})
const openHistoryDialog = (goalId: string) => {
  historyGoalId.value = goalId
  historyDialogOpen.value = true
}

const savingsForm = ref({
  name: '',
  targetAmount: null as number | null,
  monthlyRate: null as number | null,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const savingsEditId = ref<string | null>(null)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
const isFirstRunHousehold = computed(() => isFirstRun(activeHousehold.value))
const showFirstTimeEmpty = computed(
  () => (currentHousehold.value?.savingsGoals.length ?? 0) === 0 && isFirstRunHousehold.value,
)

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)
const formatDate = (value: string | null) => {
  if (!value) return 'Offen'
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function parseDateInput(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

const loadPlanning = async () => {
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

const monthlySavingsRateTotal = computed(
  () => currentHousehold.value?.savingsGoals.reduce((sum, goal) => sum + goal.monthlyRate, 0) ?? 0,
)

// Echte aggregierte Progress-Werte aus /api/households/current (issue #12).
// Der Mock vorher war zeitbasiert und hat die tatsaechlich angesparten Betraege
// ignoriert — jetzt kommt der Wert aus dem Backend (groupBy ueber alle
// SavingsGoalExecution.amount pro Goal, keine N+1).
const goalCurrentAmount = (goal: SavingsGoalItem) => goal.currentAmount ?? 0
const goalProgressPercent = (goal: SavingsGoalItem) => goal.progressPercent ?? 0
const isGoalReached = (goal: SavingsGoalItem) => goalCurrentAmount(goal) >= goal.targetAmount && goal.targetAmount > 0

// === Issue #56: monatliche Plan-vs-Ist-Anzeige =====================

/**
 * Severity-Mapping fuer den monthlyProgress-Tag. 100 % = Plan
 * erreicht, drueber = Erfolg, knapp drunter = Warnung, weit drunter
 * = Gefahr. Die Schwellen sind bewusst pragmatisch (50/100), nicht
 * progressiv — der Tag soll den User nur grob einordnen, nicht
 * micro-managen.
 *   < 50 %  -> danger   ("Deutlich unter Plan")
 *   50–99 % -> warning  ("Knapp unter Plan")
 *   >= 100 % -> success  ("Plan erreicht / ueberzogen")
 */
function severityForPercent(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 100) return 'success'
  if (percent >= 50) return 'warning'
  return 'danger'
}

/**
 * Liefert den deutschen Monatsnamen (kurz) fuer ein 'YYYY-MM'-Key.
 * Beispiel: '2026-07' -> 'Juli'. Fallback auf den rohen Key, wenn
 * das Format unerwartet ist (defensive — sollte nie passieren).
 */
function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const monthIdx = Number(month) - 1
  if (Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return monthKey
  // Date-Format mit day=2 vermeidet Timezone-Drift (Monat faengt
  // immer am 2. an, damit der UTC-Drift keine Rolle spielt).
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(year), monthIdx, 2)))
}

/**
 * Aktuellster Monats-Eintrag fuer den prominenten Tag. Kann null
 * sein, wenn das Backend (noch) keine Daten liefert — dann zeigen
 * wir den Tag gar nicht erst.
 */
function currentMonthProgress(goal: SavingsGoalItem) {
  return goal.monthlyProgress?.[0] ?? null
}

/**
 * Plan-Vergleich ausblenden, wenn der Goal keine positive Rate hat
 * (entweder kein Plan oder Entnahme-Plan). Die Page zeigt dann nur
 * die Ist-Summe, weil eine Prozent-Zahl auf 0/negativer Basis
 * semantisch sinnlos waere.
 */
function hasPositivePlan(goal: SavingsGoalItem): boolean {
  return goal.monthlyRate > 0
}

/**
 * "Plan-vs-Ist"-Block eines Goals auf-/zuklappbar. Pro Goal
 * separat, damit mehrere Cards unabhaengig expandiert sein koennen.
 * Set speichert nur Goal-IDs der aktuell geoeffneten Goals.
 */
const expandedGoals = ref<Set<string>>(new Set())
function toggleGoalExpanded(goalId: string) {
  // Reaktiv: neues Set statt Mutation, damit computed im Template
  // das Update mitbekommt.
  const next = new Set(expandedGoals.value)
  if (next.has(goalId)) {
    next.delete(goalId)
  } else {
    next.add(goalId)
  }
  expandedGoals.value = next
}
function isGoalExpanded(goalId: string): boolean {
  return expandedGoals.value.has(goalId)
}

const resetSavingsForm = () => {
  savingsForm.value = { name: '', targetAmount: null, monthlyRate: null, startDate: new Date(), endDate: null }
  savingsEditId.value = null
}

const editSavingsGoal = (goal: SavingsGoalItem) => {
  savingsEditId.value = goal.id
  savingsForm.value = {
    name: goal.name,
    targetAmount: goal.targetAmount / 100,
    monthlyRate: goal.monthlyRate / 100,
    startDate: new Date(goal.startDate),
    endDate: parseDateInput(goal.endDate),
  }
  savingsDialogOpen.value = true
}

const openSavingsDialog = () => { resetSavingsForm(); savingsDialogOpen.value = true }
const closeSavingsDialog = () => { savingsDialogOpen.value = false; resetSavingsForm() }

const saveSavingsGoal = async () => {
  if (!activeHouseholdId.value) return
  savingsLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(savingsEditId.value)
    const payload = {
      kind: 'savingsGoal',
      ...(savingsEditId.value ? { id: savingsEditId.value } : {}),
      name: savingsForm.value.name,
      targetAmount: savingsForm.value.targetAmount,
      monthlyRate: savingsForm.value.monthlyRate,
      startDate: savingsForm.value.startDate ? formatDateInput(savingsForm.value.startDate) : undefined,
      endDate: savingsForm.value.endDate ? formatDateInput(savingsForm.value.endDate) : null,
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/planning`, {
      method: savingsEditId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadPlanning()
    closeSavingsDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Sparziel wurde aktualisiert.' : 'Sparziel wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Sparziel konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    savingsLoading.value = false
  }
}

const deletePlanningItem = async (goal: { id: string; name: string }) => {
  if (!activeHouseholdId.value) return

  // ConfirmSheet (issue #51): Sparziele haben kein Undo, der Sheet
  // ist die einzige Sicherung. Confirm-Text nennt den konkreten Namen
  // und weist auf die Konsequenz (History weg) hin.
  const ok = await confirm.ask({
    title: 'Sparziel löschen?',
    message: `„${goal.name}" wird endgültig entfernt — inkl. aller Einzahlungen, Entnahmen und der Verlaufshistorie.`,
    tone: 'danger',
    confirmLabel: 'Endgültig löschen',
  })
  if (!ok) return

  actionLoadingKey.value = `savingsGoal:${goal.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/savings-goals/${goal.id}`, {
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

// ---- Execution-Booking (issue #38, in useBookingDialog extrahiert) ------
// State-Machine + Submit lebt jetzt im `useBookingDialog`-Composable.
// Page verkabelt nur die Datenquellen und entscheidet, was nach
// Erfolg passieren soll (Notice + loadPlanning). `loadPlanning` und
// `formatMoney` werden lazy im Callback referenziert — die werden
// erst beim submit() aufgerufen, lange nach setup().

const bookingDialog = useBookingDialog<SavingsGoalItem>({
  householdId: activeHouseholdId,
  getGoal: (id) => currentHousehold.value?.savingsGoals.find((g) => g.id === id),
  formatDate: formatDateInput,
  onSuccess: ({ result, direction, goalName }) => {
    const directionLabel = direction === 'deposit' ? 'eingezahlt' : 'entnommen'
    notice.value = {
      severity: 'success',
      text: `${formatMoney(result.amount)} ${directionLabel} in „${goalName}".`,
    }
    return loadPlanning()
  },
})

onMounted(async () => {
  await fetchHouseholds()
  await loadPlanning()
})
watch(activeHouseholdId, async () => { await loadPlanning() })
</script>

<template>
  <ListPageShell
    title="Sparziele"
    description="Definiere konkrete Sparziele mit Zielbetrag und monatlicher Rate."
  >
    <template #summary>
      <Tag severity="info" :value="`${currentHousehold?.savingsGoals.length ?? 0} Ziele`" />
      <Tag severity="success" :value="`${formatMoney(monthlySavingsRateTotal)}/Monat`" />
    </template>

    <template #toolbar>
      <Button label="Sparziel anlegen" icon="pi pi-plus" severity="success" @click="openSavingsDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Sparziele werden geladen"
    />

    <EmptyState
      v-if="!loading && activeHousehold && currentHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-star"
      icon-tone="warning"
      headline="Noch keine Sparziele"
      description="Definiere dein erstes Sparziel, um zu sehen, wie viel du monatlich zurücklegen musst."
      :cta="{ label: 'Sparziel anlegen', onClick: openSavingsDialog, severity: 'warning' }"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && currentHousehold && currentHousehold.savingsGoals.length === 0"
      variant="no-data"
      icon="pi pi-star"
      icon-tone="muted"
      headline="Keine Sparziele"
      description="Plane eins, sobald du ein konkretes Ziel hast — z. B. Urlaub, Notgroschen, neues Gerät."
    />

    <template v-if="!loading && activeHousehold && currentHousehold && currentHousehold.savingsGoals.length > 0">
      <ListPanel
        kicker="Sparziele"
        title="Auf dem Weg zum Zielbetrag"
        compact
        :badge="`${currentHousehold.savingsGoals.length} Einträge`"
      >
        <template #actions>
          <Button label="Neu" icon="pi pi-plus" severity="secondary" size="small" outlined @click="openSavingsDialog" />
        </template>

        <ItemCard v-for="goal in currentHousehold.savingsGoals" :key="goal.id" :progress="goalProgressPercent(goal)" :hover-actions="false">
          <template #main>
            <span class="row-title">
              <span class="row-emoji" aria-hidden="true">{{ lookupEmoji(goal.name) }}</span>
              {{ goal.name }}
              <span class="row-tag row-tag--green">{{ formatMoney(goal.monthlyRate) }}/Monat</span>
            </span>
            <span class="row-sub">
              <span class="row-tag" :class="{ 'row-tag--green': isGoalReached(goal) }">
                {{ goalProgressPercent(goal) }}% erreicht
              </span>
              <!-- Issue #56: monatlicher Plan-vs-Ist-Tag (aktueller
                   Monat). Wird nur gerendert, wenn das Backend einen
                   Eintrag liefert. Severity je nach percentUsed.
                   Bei monthlyRate <= 0 wird statt der Prozent nur die
                   Ist-Summe gezeigt (Plan-Vergleich nicht sinnvoll). -->
              <template v-if="currentMonthProgress(goal)">
                <span
                  v-if="hasPositivePlan(goal)"
                  class="row-tag"
                  :class="{
                    'row-tag--green': severityForPercent(currentMonthProgress(goal)!.percentUsed) === 'success',
                    'row-tag--warn': severityForPercent(currentMonthProgress(goal)!.percentUsed) === 'warning',
                    'row-tag--danger': severityForPercent(currentMonthProgress(goal)!.percentUsed) === 'danger',
                  }"
                  :title="`Geplant ${formatMoney(currentMonthProgress(goal)!.planned)}, real ${formatMoney(currentMonthProgress(goal)!.actual)}`"
                >
                  {{ monthLabel(currentMonthProgress(goal)!.month) }}: {{ currentMonthProgress(goal)!.percentUsed.toFixed(0) }}%
                </span>
                <span
                  v-else
                  class="row-tag row-tag--muted"
                  :title="`Ist-Buchungen diesen Monat`"
                >
                  {{ monthLabel(currentMonthProgress(goal)!.month) }}: {{ formatMoney(currentMonthProgress(goal)!.actual) }}
                </span>
              </template>
              <span>Ziel {{ formatMoney(goal.targetAmount) }}</span>
              <span>· {{ formatDate(goal.startDate) }} – {{ formatDate(goal.endDate) }}</span>
              <span v-if="goalCurrentAmount(goal) === 0" class="row-tag row-tag--muted">
                Noch keine Sparbuchungen
              </span>
              <!-- Issue #56: Toggle fuer den 3-Monats-Verlauf. Wird
                   nur gerendert, wenn das Backend ueberhaupt Daten
                   hat (sonst leerer Klapp-Block). Per Goal expandiert,
                   damit mehrere Cards unabhaengig offen sein koennen. -->
              <button
                v-if="goal.monthlyProgress && goal.monthlyProgress.length > 0"
                type="button"
                class="row-history-toggle"
                :aria-expanded="isGoalExpanded(goal.id)"
                :aria-label="`Plan-vs-Ist-Verlauf fuer ${goal.name} ${isGoalExpanded(goal.id) ? 'ausblenden' : 'anzeigen'}`"
                @click="toggleGoalExpanded(goal.id)"
              >
                <i
                  :class="['pi', isGoalExpanded(goal.id) ? 'pi-chevron-up' : 'pi-chevron-down', 'row-history-toggle__icon']"
                  aria-hidden="true"
                />
                {{ isGoalExpanded(goal.id) ? 'Verlauf ausblenden' : '3-Monats-Verlauf' }}
              </button>
            </span>
            <!-- Issue #56: Aufklappbarer 3-Monats-Verlauf. Bewusst
                 ein einfacher Block ohne Tabelle — die 3 Zeilen
                 passen gut als Text-Liste, das ist schneller zu
                 scannen als eine Mini-Tabelle. -->
            <ul v-if="isGoalExpanded(goal.id) && goal.monthlyProgress" class="row-history">
              <li
                v-for="entry in goal.monthlyProgress"
                :key="entry.month"
                class="row-history__entry"
              >
                <span class="row-history__month">{{ monthLabel(entry.month) }}</span>
                <span class="row-history__values">
                  <template v-if="hasPositivePlan(goal)">
                    geplant {{ formatMoney(entry.planned) }} · real {{ formatMoney(entry.actual) }}
                    <span
                      class="row-history__pct"
                      :class="{
                        'row-history__pct--green': severityForPercent(entry.percentUsed) === 'success',
                        'row-history__pct--warn': severityForPercent(entry.percentUsed) === 'warning',
                        'row-history__pct--danger': severityForPercent(entry.percentUsed) === 'danger',
                      }"
                    >
                      ({{ entry.percentUsed.toFixed(0) }}%)
                    </span>
                  </template>
                  <template v-else>
                    {{ formatMoney(entry.actual) }}
                  </template>
                </span>
              </li>
            </ul>
          </template>
          <template #aside>
            <div>
              <strong>{{ formatMoney(goalCurrentAmount(goal)) }}</strong>
              <span class="amount-secondary">
                von {{ formatMoney(goal.targetAmount) }}
              </span>
            </div>
          </template>
          <template #actions>
            <!-- Issue #38: Booking-Actions (Einzahlen / Entnehmen).
                 Bewusst immer sichtbar (`hoverActions=false` am ItemCard),
                 weil das der primaere Use-Case auf der Sparziel-Seite ist.
                 Edit/Delete bleiben daneben, leicht abgegraut. -->
            <Button
              icon="pi pi-plus-circle"
              severity="success"
              text
              size="small"
              :aria-label="`In Sparziel ${goal.name} einzahlen`"
              @click="bookingDialog.open(goal.id, 'deposit')"
            />
            <Button
              icon="pi pi-minus-circle"
              severity="danger"
              text
              size="small"
              :aria-label="`Aus Sparziel ${goal.name} entnehmen`"
              @click="bookingDialog.open(goal.id, 'withdraw')"
            />
            <span class="goal-card-actions-divider" aria-hidden="true" />
            <!-- Issue #39: History-Button pro Card. -->
            <Button
              icon="pi pi-list"
              severity="secondary"
              text
              size="small"
              :aria-label="`Bewegungen fuer ${goal.name} anzeigen`"
              @click="openHistoryDialog(goal.id)"
            />
            <Button icon="pi pi-pen-to-square" severity="secondary" text size="small" aria-label="Sparziel bearbeiten" @click="editSavingsGoal(goal)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              aria-label="Sparziel löschen"
              :loading="actionLoadingKey === `savingsGoal:${goal.id}`"
              @click="deletePlanningItem(goal)"
            />
          </template>
        </ItemCard>

        <div v-if="currentHousehold.savingsGoals.length === 0" class="empty-list">Noch keine Sparziele angelegt.</div>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="savingsDialogOpen"
      :header="savingsEditId ? 'Sparziel bearbeiten' : 'Sparziel anlegen'"
      :submit-label="savingsEditId ? 'Sparziel aktualisieren' : 'Sparziel anlegen'"
      :saving="savingsLoading"
      @save="saveSavingsGoal"
      @cancel="closeSavingsDialog"
      width="min(50rem, 94vw)"
    >
      <FormFieldRow label="Name" html-for="goal-name" wide>
        <InputText id="goal-name" v-model="savingsForm.name" placeholder="z. B. Urlaub" />
      </FormFieldRow>
      <FormFieldRow label="Zielbetrag" html-for="goal-target">
        <MoneyInput id="goal-target" v-model="savingsForm.targetAmount" :currency="currencyCode" />
      </FormFieldRow>
      <FormFieldRow label="Monatliche Rate" html-for="goal-rate">
        <MoneyInput id="goal-rate" v-model="savingsForm.monthlyRate" :currency="currencyCode" :min="0" />
      </FormFieldRow>
      <FormFieldRow label="Start" html-for="goal-start">
        <DatePicker id="goal-start" v-model="savingsForm.startDate" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
      <FormFieldRow label="Ende" html-for="goal-end">
        <DatePicker id="goal-end" v-model="savingsForm.endDate" showIcon dateFormat="dd.mm.yy" />
      </FormFieldRow>
    </FormDialog>

    <!-- Execution-Booking-Dialog (issue #38). Wird per
         `bookingDialog.open(goalId, direction)` geoeffnet und kennt seine
         Richtung (`Einzahlen` / `Entnehmen`) schon beim Oeffnen.
         State + Submit liegen in `useBookingDialog`. -->
    <FormDialog
      v-model:visible="bookingDialog.dialogOpen.value"
      :header="bookingDialog.direction.value === 'deposit' ? 'Einzahlung buchen' : 'Entnahme buchen'"
      :submit-label="bookingDialog.direction.value === 'deposit' ? 'Einzahlen' : 'Entnehmen'"
      :submit-severity="bookingDialog.direction.value === 'deposit' ? 'success' : 'danger'"
      :saving="bookingDialog.posting.value"
      width="min(38rem, 94vw)"
      @save="bookingDialog.submit()"
      @cancel="bookingDialog.close()"
    >
      <p v-if="bookingDialog.goal.value" class="booking-context">
        {{ bookingDialog.direction.value === 'deposit' ? 'Einzahlung' : 'Entnahme' }} fuer
        <strong>{{ bookingDialog.goal.value.name }}</strong>
        ({{ formatMoney(bookingDialog.goal.value.targetAmount) }} Zielbetrag).
      </p>
      <Message v-if="bookingDialog.error.value" severity="error" variant="simple" class="booking-error">
        {{ bookingDialog.error.value }}
      </Message>
      <FormFieldRow label="Betrag" html-for="booking-amount">
        <MoneyInput
          id="booking-amount"
          v-model="bookingDialog.form.value.amount"
          :currency="currencyCode"
          :min="0"
        />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="booking-date">
        <DatePicker
          id="booking-date"
          v-model="bookingDialog.form.value.date"
          showIcon
          dateFormat="dd.mm.yy"
        />
        <!-- Issue #54: Helper-Hint analog zum Expense/Income-Form.
             Booking ist die haeufigste Aktion auf der Sparziel-Seite,
             der User soll auf einen Blick wissen, dass das Datum
             standardmaessig "heute" ist. -->
        <small class="form-field-helper">{{ todayDateHelperText }}</small>
      </FormFieldRow>
      <FormFieldRow label="Notiz (optional)" html-for="booking-note" wide>
        <InputText
          id="booking-note"
          v-model="bookingDialog.form.value.note"
          placeholder="z. B. Urlaubssparen Q3"
          maxlength="500"
        />
      </FormFieldRow>
    </FormDialog>

    <!-- History-Dialog (issue #39). Zeigt die Bewegungen des
         ausgewaehlten Sparziels. Laedt seine Daten selbst ueber
         `useSavingsExecutionHistory`; reset beim Schliessen. -->
    <SavingsHistoryDialog
      v-model:visible="historyDialogOpen"
      :goal="historyGoal"
      :household-id="activeHouseholdId"
      :currency="currencyCode"
    />
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

.row-tag--green {
  background: rgba(52, 211, 153, 0.16);
  color: #34d399;
}

.row-tag--muted {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
}

/* Issue #56: warn/danger-Severity fuer den monatlichen Plan-vs-Ist-Tag.
   Nutzt die gleichen Background-Tones wie das restliche Design (siehe
   Action-Required), damit der User die Schwere auf einen Blick
   einordnen kann ohne neue Farbcodes zu lernen. */
.row-tag--warn {
  background: rgba(251, 191, 36, 0.18);
  color: #fbbf24;
}

.row-tag--danger {
  background: rgba(248, 113, 113, 0.18);
  color: #f87171;
}

/* Issue #56: Inline-Toggle fuer den 3-Monats-Verlauf. Bewusst als
   <button> (nicht <a> oder <div>), damit er per Tastatur + Screenreader
   korrekt funktioniert. Sieht aus wie ein Tag, verhaelt sich wie ein
   Button. */
.row-history-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  background: rgba(59, 130, 246, 0.10);
  color: #93c5fd;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.row-history-toggle:hover {
  background: rgba(59, 130, 246, 0.20);
  border-color: rgba(96, 165, 250, 0.32);
}

.row-history-toggle__icon {
  font-size: 0.65rem;
}

/* Issue #56: Aufklappbarer 3-Monats-Verlauf. Kompakte Liste,
   eingerueckt unter dem Goal-Subtitle, damit der User den
   Monats-Kontext nicht aus den Augen verliert. */
.row-history {
  list-style: none;
  padding: 0.5rem 0 0;
  margin: 0.4rem 0 0;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: 100%;
  flex-basis: 100%;
}

.row-history__entry {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  font-size: 0.78rem;
  color: var(--color-text-muted, #cbd5e1);
  font-variant-numeric: tabular-nums;
}

.row-history__month {
  font-weight: 600;
  color: var(--color-text-secondary, #cbd5e1);
  white-space: nowrap;
}

.row-history__values {
  text-align: right;
  white-space: nowrap;
}

.row-history__pct {
  font-weight: 700;
  margin-left: 0.3rem;
}

.row-history__pct--green {
  color: #34d399;
}

.row-history__pct--warn {
  color: #fbbf24;
}

.row-history__pct--danger {
  color: #f87171;
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

.row-emoji {
  display: inline-block;
  font-size: 1.1rem;
  /* Emoji-Schriftarten-Fallback: native Emoji-Rendering bevorzugen,
     sonst System-Fallback. */
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
    'Twemoji', sans-serif;
  line-height: 1;
}

/* Trennlinie zwischen Booking-Buttons und Edit/Delete in der Card.
   Visuell abgesetzt, damit die primaere Aktion (Buchen) vom
   Setup-Kram (Edit/Delete) getrennt bleibt. */
.goal-card-actions-divider {
  display: inline-block;
  width: 1px;
  height: 22px;
  background: var(--border-subtle, rgba(148, 163, 184, 0.25));
  margin: 0 4px;
}

@media (max-width: 639px) {
  .goal-card-actions-divider {
    display: none;
  }
}

/* Buchungs-Dialog: Kontext-Text oben und Error-Message unter dem Header.
   Etwas mehr Luft als die Standard-Reihen, weil das die haeufigste
   Aktion auf der Sparziel-Seite ist und der User sie schnell erfassen
   soll. */
.booking-context {
  margin: 0 0 0.4rem;
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.86rem;
}

.booking-error {
  margin-bottom: 0.6rem;
}
</style>