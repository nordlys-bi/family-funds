<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { isFirstRun } from '~/utils/household-age'
import { useEmojiLookup } from '~/composables/useEmojiLookup'
import { useSavingsExecutions, type ExecutionDirection } from '~/composables/useSavingsExecutions'

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
const { posting: postingExecution, error: executionError, bookExecution, clearError } = useSavingsExecutions()

const currentHousehold = ref<PlanningHousehold | null>(null)
const loading = ref(false)
const notice = ref<Notice | null>(null)
const savingsLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const savingsDialogOpen = ref(false)

const savingsForm = ref({
  name: '',
  targetAmount: null as number | null,
  monthlyRate: null as number | null,
  startDate: new Date() as DateFormValue,
  endDate: null as DateFormValue,
})
const savingsEditId = ref<string | null>(null)

// Execution-Booking-State (issue #38). Pro Card-Action "Einzahlen"/"Entnehmen"
// wird `bookingGoalId` + `bookingDirection` gesetzt, dann oeffnet sich der
// `bookingDialog`. Nach erfolgreichem Buchen ruft `submitBookingExecution()`
// `loadPlanning()` auf, damit die Liste + (spaeter) aggregierter Stand frisch
// sind.
const bookingDialogOpen = ref(false)
const bookingGoalId = ref<string | null>(null)
const bookingDirection = ref<ExecutionDirection>('deposit')
const bookingForm = ref({
  amount: null as number | null,
  date: new Date() as DateFormValue,
  note: '',
})
const bookingError = ref<string | null>(null)

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

// Mock progress: zwischen 0 und 100% je nach Ziel — wir haben keine echten Buchungen
// TODO: echte "Sparbuchungen"-Datenquelle anbinden, dann diesen Mock ersetzen
const goalProgressPercent = (goal: SavingsGoalItem) => {
  // Stabil basierend auf Monaten seit Start vs. erwarteter Dauer
  const start = new Date(goal.startDate).getTime()
  const end = goal.endDate ? new Date(goal.endDate).getTime() : start
  const now = Date.now()
  if (end <= start) return 0
  const total = end - start
  const elapsed = Math.max(0, Math.min(total, now - start))
  return Math.round((elapsed / total) * 100)
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

const deletePlanningItem = async (id: string) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `savingsGoal:${id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/savings-goals/${id}`, {
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

// ---- Execution-Booking (issue #38) --------------------------------------

const openBookingDialog = (goalId: string, direction: ExecutionDirection) => {
  bookingGoalId.value = goalId
  bookingDirection.value = direction
  bookingForm.value = { amount: null, date: new Date(), note: '' }
  bookingError.value = null
  clearError()
  bookingDialogOpen.value = true
}

const closeBookingDialog = () => {
  bookingDialogOpen.value = false
  bookingGoalId.value = null
  bookingError.value = null
}

const bookingGoal = computed(() => {
  if (!bookingGoalId.value) return null
  return currentHousehold.value?.savingsGoals.find((g) => g.id === bookingGoalId.value) ?? null
})

const isBookingFormValid = computed(() => {
  const amount = bookingForm.value.amount
  return Number.isFinite(amount) && amount !== null && amount !== 0 && bookingForm.value.date !== null
})

const submitBookingExecution = async () => {
  bookingError.value = null
  if (!bookingGoalId.value || !activeHouseholdId.value) {
    bookingError.value = 'Sparziel oder Haushalt fehlt.'
    return
  }
  if (!isBookingFormValid.value) {
    bookingError.value = 'Betrag muss ungleich 0 sein, Datum ist erforderlich.'
    return
  }
  const goal = bookingGoal.value
  if (!goal) {
    bookingError.value = 'Sparziel nicht gefunden.'
    return
  }
  const dateValue = bookingForm.value.date!
  const dateIso = formatDateInput(dateValue)
  const result = await bookExecution(
    activeHouseholdId.value,
    bookingGoalId.value,
    bookingDirection.value,
    {
      amount: Math.abs(bookingForm.value.amount!),
      date: dateIso,
      note: bookingForm.value.note?.trim() || undefined,
    },
  )
  if (!result) {
    bookingError.value = executionError.value ?? 'Buchung fehlgeschlagen.'
    return
  }
  // Erfolg: Dialog schliessen, Liste neu laden, kompaktes Feedback.
  const directionLabel = bookingDirection.value === 'deposit' ? 'eingezahlt' : 'entnommen'
  notice.value = {
    severity: 'success',
    text: `${formatMoney(result.amount)} ${directionLabel} in „${goal.name}".`,
  }
  closeBookingDialog()
  await loadPlanning()
}

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
              <span class="row-tag">{{ goalProgressPercent(goal) }}% Zeitfortschritt</span>
              <span>Ziel {{ formatMoney(goal.targetAmount) }}</span>
              <span>· {{ formatDate(goal.startDate) }} – {{ formatDate(goal.endDate) }}</span>
            </span>
          </template>
          <template #aside>
            <div>
              {{ formatMoney(goal.targetAmount) }}
              <span class="amount-secondary">Zielbetrag</span>
            </div>
          </template>
          <template #actions>
            <!-- Issue #38: Booking-Actions (Einzahlen / Entnehmen).
                 Bewusst immer sichtbar (`hoverActions=false` am ItemCard),
                 weil das der primaere Use-Case auf der Sparziel-Seite ist.
                 Edit/Delete bleiben daneben, leicht abgegraut. -->
            <Button
              icon="pi pi-arrow-down"
              :label="`Einzahlen`"
              severity="success"
              size="small"
              :aria-label="`In Sparziel ${goal.name} einzahlen`"
              @click="openBookingDialog(goal.id, 'deposit')"
            />
            <Button
              icon="pi pi-arrow-up"
              :label="`Entnehmen`"
              severity="danger"
              outlined
              size="small"
              :aria-label="`Aus Sparziel ${goal.name} entnehmen`"
              @click="openBookingDialog(goal.id, 'withdraw')"
            />
            <span class="goal-card-actions-divider" aria-hidden="true" />
            <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Sparziel bearbeiten" @click="editSavingsGoal(goal)" />
            <Button
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              text
              aria-label="Sparziel löschen"
              :loading="actionLoadingKey === `savingsGoal:${goal.id}`"
              @click="deletePlanningItem(goal.id)"
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
         `openBookingDialog(goalId, direction)` geoeffnet und kennt seine
         Richtung (`Einzahlen` / `Entnehmen`) schon beim Oeffnen. -->
    <FormDialog
      v-model:visible="bookingDialogOpen"
      :header="bookingDirection === 'deposit' ? 'Einzahlung buchen' : 'Entnahme buchen'"
      :submit-label="bookingDirection === 'deposit' ? 'Einzahlen' : 'Entnehmen'"
      :submit-severity="bookingDirection === 'deposit' ? 'success' : 'danger'"
      :saving="postingExecution"
      width="min(38rem, 94vw)"
      @save="submitBookingExecution"
      @cancel="closeBookingDialog"
    >
      <p v-if="bookingGoal" class="booking-context">
        {{ bookingDirection === 'deposit' ? 'Einzahlung' : 'Entnahme' }} fuer
        <strong>{{ bookingGoal.name }}</strong>
        ({{ formatMoney(bookingGoal.targetAmount) }} Zielbetrag).
      </p>
      <Message v-if="bookingError" severity="error" variant="simple" class="booking-error">
        {{ bookingError }}
      </Message>
      <FormFieldRow label="Betrag" html-for="booking-amount">
        <MoneyInput
          id="booking-amount"
          v-model="bookingForm.amount"
          :currency="currencyCode"
          :min="0"
        />
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="booking-date">
        <DatePicker
          id="booking-date"
          v-model="bookingForm.date"
          showIcon
          dateFormat="dd.mm.yy"
        />
      </FormFieldRow>
      <FormFieldRow label="Notiz (optional)" html-for="booking-note" wide>
        <InputText
          id="booking-note"
          v-model="bookingForm.note"
          placeholder="z. B. Urlaubssparen Q3"
          maxlength="500"
        />
      </FormFieldRow>
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

.row-tag--green {
  background: rgba(52, 211, 153, 0.16);
  color: #34d399;
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