<!--
  Kontoseite (ADR-0006, issue #191): wo das Geld liegt und wie es dorthin kam.

  Saldo von heute und alle Bewegungen ab dem Start des Kontos, neueste
  zuerst, jeweils mit dem Saldo danach: Anfangsbestand, Ausgaben, Einnahmen
  und Kontouebertraege. Uebertraege lassen sich hier aendern (Betrag, Datum,
  Notiz) und loeschen; Ausgaben und Einnahmen bearbeitet man in der
  Buchungsliste.

  Abgleich (#192): echten Stand zu einem Tag eingeben, die Differenz zum
  berechneten Stand sehen, fehlende Buchungen nacherfassen und den Rest als
  Korrektur ausbuchen. Die Korrektur trifft das Konto und "Zu verteilen",
  nie einen Umschlag. Auch ein Abgleich ohne Differenz bleibt als
  "Abgeglichen" im Verlauf.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { accountErrorText, accountTypeIcon, accountTypeLabel, type AccountType } from '~/utils/account-options'

definePageMeta({ layout: 'default' })

type HistoryEntry = {
  type: 'opening' | 'income' | 'expense' | 'transfer' | 'adjustment'
  id: string | null
  date: string
  amount: number
  text: string | null
  envelopeName: string | null
  counterpartId: string | null
  counterpartName: string | null
  userName: string | null
  statedBalance: number | null
  balance: number
}

type AccountDetail = {
  id: string
  name: string
  type: AccountType
  startDate: string
  closedAt: string | null
  balance: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const route = useRoute()
const { activeHousehold, activeHouseholdId, fetchHouseholds } = useHousehold()
const confirm = useAskConfirm()
const quickCapture = useQuickCapture()

const accountId = computed(() => String(route.params.id ?? ''))
const currency = computed(() => activeHousehold.value?.currency ?? 'EUR')
const money = (cents: number) => formatMoneyFromCents(cents, currency.value)
const signedMoney = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${money(Math.abs(cents))}`

const account = ref<AccountDetail | null>(null)
const entries = ref<HistoryEntry[]>([])
const loading = ref(true)
const notFound = ref(false)
const message = ref<{ severity: 'success' | 'error'; text: string } | null>(null)

async function load() {
  if (!activeHouseholdId.value) return
  if (!UUID_PATTERN.test(accountId.value)) {
    notFound.value = true
    loading.value = false
    return
  }
  loading.value = true
  try {
    const data = await $fetch<{ account: AccountDetail; entries: HistoryEntry[] }>(
      `/api/households/${activeHouseholdId.value}/accounts/${accountId.value}`,
    )
    account.value = data.account
    entries.value = data.entries
    notFound.value = false
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.response?.status === 404) notFound.value = true
    else message.value = { severity: 'error', text: 'Konto konnte nicht geladen werden: ' + accountErrorText(error) }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await load()
})
watch([activeHouseholdId, accountId], load)
watch(quickCapture.savedTick, load)

/** Was die Bewegung war: Beschreibung, sonst die Art. */
function title(entry: HistoryEntry) {
  if (entry.type === 'opening') return 'Anfangsbestand'
  if (entry.type === 'transfer') return entry.text || 'Übertrag'
  if (entry.type === 'adjustment') return entry.amount === 0 ? 'Abgeglichen' : 'Korrektur'
  return entry.text || (entry.type === 'income' ? 'Einnahme' : 'Ausgabe')
}

/** Gegenkonto eines Uebertrags, sonst der Umschlag der Buchung. */
function where(entry: HistoryEntry) {
  if (entry.type === 'transfer') return `${entry.amount < 0 ? 'nach' : 'von'} ${entry.counterpartName ?? 'anderem Konto'}`
  return entry.envelopeName ?? 'Zu verteilen'
}

/** Zweite Zeile: wohin bzw. woher und wer gebucht hat. */
function detail(entry: HistoryEntry) {
  if (entry.type === 'opening') return null
  if (entry.type === 'adjustment') {
    return [`Stand laut Abgleich ${money(entry.statedBalance ?? 0)}`, entry.text, entry.userName].filter(Boolean).join(' · ')
  }
  return [where(entry), entry.userName].filter(Boolean).join(' · ')
}

function openTransfer() {
  quickCapture.open('accountTransfer', { accountId: accountId.value })
}

// === Uebertrag aendern ======================================================
// Nur Betrag, Datum und Notiz; die Konten bleiben fest (loeschen und neu
// buchen), wie bei Umbuchungen zwischen Umschlaegen.
const edit = ref<{ id: string; amount: number | null; date: Date; note: string } | null>(null)
const editSaving = ref(false)
const editError = ref<string | null>(null)
const editOpen = computed({
  get: () => edit.value !== null,
  set: (open) => { if (!open) edit.value = null },
})

function openEdit(entry: HistoryEntry) {
  if (entry.type !== 'transfer' || !entry.id) return
  editError.value = null
  edit.value = { id: entry.id, amount: Math.abs(entry.amount) / 100, date: new Date(entry.date), note: entry.text ?? '' }
}

async function saveEdit() {
  if (!edit.value || !activeHouseholdId.value) return
  if (!edit.value.amount || edit.value.amount <= 0) {
    editError.value = 'Betrag muss größer als 0 sein.'
    return
  }
  editSaving.value = true
  editError.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/account-transfers/${edit.value.id}`, {
      method: 'PATCH',
      body: { amount: edit.value.amount, date: formatDateToInputString(edit.value.date), note: edit.value.note },
    })
    edit.value = null
    message.value = { severity: 'success', text: 'Übertrag wurde geändert.' }
    await load()
  } catch (error: any) {
    editError.value = accountErrorText(error)
  } finally {
    editSaving.value = false
  }
}

// === Abgleich =================================================================
const reconcile = ref<{ date: Date; stated: number | null; note: string } | null>(null)
const reconcileComputed = ref<number | null>(null)
const reconcileSaving = ref(false)
const reconcileError = ref<string | null>(null)
const reconcileOpen = computed({
  get: () => reconcile.value !== null,
  set: (open) => { if (!open) reconcile.value = null },
})
const today = () => {
  const value = new Date()
  value.setHours(12, 0, 0, 0)
  return value
}
const reconcileMinDate = computed(() => (account.value ? new Date(account.value.startDate) : undefined))
/** Differenz in Cent: was ausgebucht wird; null, solange etwas fehlt. */
const reconcileDifference = computed(() => {
  if (!reconcile.value || reconcile.value.stated == null || reconcileComputed.value == null) return null
  return Math.round(reconcile.value.stated * 100) - reconcileComputed.value
})

function openReconcile() {
  reconcileError.value = null
  reconcile.value = { date: today(), stated: null, note: '' }
}

async function loadReconcileComputed() {
  if (!reconcile.value || !activeHouseholdId.value) return
  reconcileComputed.value = null
  try {
    const data = await $fetch<{ computedBalance: number }>(
      `/api/households/${activeHouseholdId.value}/accounts/${accountId.value}/reconciliation`,
      { params: { date: formatDateToInputString(reconcile.value.date) } },
    )
    reconcileComputed.value = data.computedBalance
  } catch (error: any) {
    reconcileError.value = accountErrorText(error)
  }
}
// Neu rechnen bei anderem Tag und nach jeder Buchung, die von hier aus
// nacherfasst wurde.
watch(() => reconcile.value?.date?.getTime(), loadReconcileComputed)
watch(quickCapture.savedTick, loadReconcileComputed)

/** Fehlende Buchung nacherfassen; der Dialog bleibt offen und rechnet neu. */
function captureMissing(kind: 'expense' | 'income') {
  quickCapture.open(kind, { accountId: accountId.value })
}

async function saveReconcile() {
  if (!reconcile.value || !activeHouseholdId.value) return
  if (reconcile.value.stated == null) {
    reconcileError.value = 'Bitte den echten Kontostand eingeben.'
    return
  }
  reconcileSaving.value = true
  reconcileError.value = null
  const difference = reconcileDifference.value
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/accounts/${accountId.value}/reconciliation`, {
      method: 'POST',
      body: { date: formatDateToInputString(reconcile.value.date), statedBalance: reconcile.value.stated, note: reconcile.value.note },
    })
    reconcile.value = null
    message.value = {
      severity: 'success',
      text: difference ? `Differenz von ${signedMoney(difference)} als Korrektur ausgebucht.` : 'Konto als abgeglichen gespeichert.',
    }
    await load()
  } catch (error: any) {
    reconcileError.value = accountErrorText(error)
  } finally {
    reconcileSaving.value = false
  }
}

async function removeAdjustment(entry: HistoryEntry) {
  if (entry.type !== 'adjustment' || !entry.id || !activeHouseholdId.value) return
  const ok = await confirm.ask({
    title: entry.amount === 0 ? 'Abgleich löschen?' : 'Korrektur löschen?',
    message: entry.amount === 0
      ? `Der Abgleich vom ${formatPlanningDate(entry.date)} wird entfernt. Beträge ändern sich nicht.`
      : `${signedMoney(entry.amount)} vom ${formatPlanningDate(entry.date)}. Konto und „Zu verteilen“ ändern sich zurück.`,
    confirmLabel: 'Löschen',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/account-adjustments/${entry.id}`, { method: 'DELETE' })
    message.value = { severity: 'success', text: 'Abgleich wurde gelöscht.' }
    await load()
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Abgleich konnte nicht gelöscht werden: ' + accountErrorText(error) }
  }
}

async function removeTransfer(entry: HistoryEntry) {
  if (entry.type !== 'transfer' || !entry.id || !activeHouseholdId.value) return
  const ok = await confirm.ask({
    title: 'Übertrag löschen?',
    message: `${money(Math.abs(entry.amount))} ${where(entry)} am ${formatPlanningDate(entry.date)}. Beide Kontosalden ändern sich zurück.`,
    confirmLabel: 'Löschen',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/account-transfers/${entry.id}`, { method: 'DELETE' })
    message.value = { severity: 'success', text: 'Übertrag wurde gelöscht.' }
    await load()
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Übertrag konnte nicht gelöscht werden: ' + accountErrorText(error) }
  }
}
</script>

<template>
  <section class="account-detail">
    <NuxtLink to="/households/accounts" class="back-link">
      <i class="pi pi-arrow-left" aria-hidden="true" />
      Alle Konten
    </NuxtLink>

    <EmptyState :loading="loading && !account" :no-household="!loading && !activeHouseholdId" loading-title="Konto wird geladen" />

    <EmptyState
      v-if="!loading && notFound"
      variant="no-results"
      icon="pi pi-search"
      icon-tone="muted"
      headline="Konto nicht gefunden"
      description="Dieses Konto gibt es in diesem Haushalt nicht."
    />

    <ListPageShell v-else-if="account" :title="account.name" :eyebrow="accountTypeLabel(account.type)">
      <template #summary>
        <Tag :severity="account.balance < 0 ? 'danger' : 'info'" :value="`Saldo ${money(account.balance)}`" />
      </template>

      <template #toolbar>
        <span class="account-meta">
          <i :class="accountTypeIcon(account.type)" aria-hidden="true" />
          seit {{ formatPlanningDate(account.startDate) }}
          <template v-if="account.closedAt"> · geschlossen ab {{ formatPlanningDate(account.closedAt) }}</template>
        </span>
        <Button
          v-if="!account.closedAt"
          label="Abgleichen"
          icon="pi pi-check-square"
          severity="secondary"
          outlined
          @click="openReconcile"
        />
        <Button
          v-if="!account.closedAt"
          label="Übertrag"
          icon="pi pi-arrow-right-arrow-left"
          severity="secondary"
          outlined
          @click="openTransfer"
        />
      </template>

      <Message v-if="message" :severity="message.severity" variant="simple">{{ message.text }}</Message>

      <ListPanel title="Verlauf" compact :badge="`${entries.length}`">
        <ListTable dense accent="primary">
          <template #head>
            <th>Datum</th>
            <th>Bewegung</th>
            <th class="num">Betrag</th>
            <th class="num muted">Saldo</th>
            <th class="actions"></th>
          </template>

          <tr v-for="entry in entries" :key="`${entry.type}-${entry.id ?? 'opening'}`">
            <td class="muted entry-date">{{ formatPlanningDate(entry.date) }}</td>
            <td class="name">
              <span class="entry-title">
                <i v-if="entry.type === 'transfer'" class="pi pi-arrow-right-arrow-left" aria-hidden="true" />
                <i v-else-if="entry.type === 'adjustment'" class="pi pi-check-square" aria-hidden="true" />
                {{ title(entry) }}
              </span>
              <span v-if="detail(entry)" class="sub">{{ detail(entry) }}</span>
            </td>
            <td :class="['num', entry.amount < 0 ? 'amount-out' : 'amount-in']">
              {{ entry.type === 'opening' ? money(entry.amount) : signedMoney(entry.amount) }}
            </td>
            <td class="num muted">{{ money(entry.balance) }}</td>
            <td class="actions">
              <template v-if="entry.type === 'transfer'">
                <Button icon="pi pi-pen-to-square" severity="secondary" text size="small" aria-label="Übertrag ändern" @click="openEdit(entry)" />
                <Button icon="pi pi-trash" severity="danger" text size="small" aria-label="Übertrag löschen" @click="removeTransfer(entry)" />
              </template>
              <Button
                v-else-if="entry.type === 'adjustment'"
                icon="pi pi-trash"
                severity="danger"
                text
                size="small"
                aria-label="Abgleich löschen"
                @click="removeAdjustment(entry)"
              />
            </td>
          </tr>

          <template #mobile>
            <div v-for="entry in entries" :key="`m-${entry.type}-${entry.id ?? 'opening'}`" class="data-table__card">
              <div class="data-table__card-line">
                <span class="data-table__card-name">{{ title(entry) }}</span>
                <span :class="entry.amount < 0 ? 'amount-out' : 'amount-in'">
                  {{ entry.type === 'opening' ? money(entry.amount) : signedMoney(entry.amount) }}
                </span>
              </div>
              <div class="data-table__card-meta">
                <span>{{ formatPlanningDate(entry.date) }}<template v-if="detail(entry)"> · {{ detail(entry) }}</template></span>
                <span>Saldo {{ money(entry.balance) }}</span>
              </div>
              <div v-if="entry.type === 'transfer'" class="data-table__card-actions">
                <Button icon="pi pi-pen-to-square" severity="secondary" text size="small" aria-label="Übertrag ändern" @click="openEdit(entry)" />
                <Button icon="pi pi-trash" severity="danger" text size="small" aria-label="Übertrag löschen" @click="removeTransfer(entry)" />
              </div>
              <div v-else-if="entry.type === 'adjustment'" class="data-table__card-actions">
                <Button icon="pi pi-trash" severity="danger" text size="small" aria-label="Abgleich löschen" @click="removeAdjustment(entry)" />
              </div>
            </div>
          </template>
        </ListTable>
      </ListPanel>
    </ListPageShell>

    <FormDialog
      v-model:visible="reconcileOpen"
      header="Konto abgleichen"
      :submit-label="reconcileDifference ? 'Differenz ausbuchen' : 'Als abgeglichen speichern'"
      :saving="reconcileSaving"
      width="min(38rem, 94vw)"
      @save="saveReconcile"
      @cancel="reconcile = null"
    >
      <template v-if="reconcile">
        <Message v-if="reconcileError" severity="error" variant="simple">{{ reconcileError }}</Message>
        <FormFieldRow label="Stand am Ende von" html-for="reconcile-date">
          <DatePicker
            id="reconcile-date"
            v-model="reconcile.date"
            date-format="dd.mm.yy"
            show-icon
            :min-date="reconcileMinDate"
            :max-date="today()"
          />
        </FormFieldRow>
        <FormFieldRow label="Echter Kontostand" html-for="reconcile-stated">
          <MoneyInput id="reconcile-stated" v-model="reconcile.stated" :currency="currency" placeholder="laut Auszug oder Zählung" />
        </FormFieldRow>

        <dl class="reconcile-summary">
          <div>
            <dt>Berechnet</dt>
            <dd>{{ reconcileComputed == null ? '…' : money(reconcileComputed) }}</dd>
          </div>
          <div>
            <dt>Differenz</dt>
            <dd :class="{ 'reconcile-summary__off': reconcileDifference }">
              {{ reconcileDifference == null ? '–' : signedMoney(reconcileDifference) }}
            </dd>
          </div>
        </dl>

        <template v-if="reconcileDifference">
          <p class="reconcile-hint">
            Fehlt eine Buchung? Erfasse sie nach, die Differenz rechnet sich neu. Was dann noch offen ist, geht als
            Korrektur nach „Zu verteilen“ und zählt nicht als Ausgabe oder Einnahme.
          </p>
          <div class="reconcile-actions">
            <Button label="Ausgabe nacherfassen" icon="pi pi-minus" severity="secondary" outlined size="small" @click="captureMissing('expense')" />
            <Button label="Einnahme nacherfassen" icon="pi pi-plus" severity="secondary" outlined size="small" @click="captureMissing('income')" />
          </div>
        </template>

        <FormFieldRow label="Notiz (optional)" html-for="reconcile-note" wide>
          <InputText id="reconcile-note" v-model="reconcile.note" placeholder="z. B. Kontoauszug November" />
        </FormFieldRow>
      </template>
    </FormDialog>

    <FormDialog
      v-model:visible="editOpen"
      header="Übertrag ändern"
      submit-label="Speichern"
      :saving="editSaving"
      width="min(36rem, 94vw)"
      @save="saveEdit"
      @cancel="edit = null"
    >
      <template v-if="edit">
        <Message v-if="editError" severity="error" variant="simple">{{ editError }}</Message>
        <FormFieldRow label="Betrag" html-for="transfer-amount">
          <MoneyInput id="transfer-amount" v-model="edit.amount" :currency="currency" :min="0" />
        </FormFieldRow>
        <FormFieldRow label="Datum" html-for="transfer-date">
          <DatePicker id="transfer-date" v-model="edit.date" date-format="dd.mm.yy" show-icon />
        </FormFieldRow>
        <FormFieldRow label="Notiz" html-for="transfer-note" wide>
          <InputText id="transfer-note" v-model="edit.note" placeholder="z. B. Geld abheben" />
        </FormFieldRow>
        <small class="form-field-helper">Die Konten bleiben fest. Für ein anderes Konto den Übertrag löschen und neu buchen.</small>
      </template>
    </FormDialog>
  </section>
</template>

<style scoped>
.account-detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  text-decoration: none;
}

.back-link:hover {
  color: var(--color-accent-primary-text);
}

.account-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-right: auto;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.reconcile-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin: 0.25rem 0 0.5rem;
}

.reconcile-summary div {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
}

.reconcile-summary dt {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.reconcile-summary dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.reconcile-summary__off {
  color: var(--color-accent-danger-text);
}

.reconcile-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.reconcile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.entry-date {
  white-space: nowrap;
}

.entry-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.entry-title i {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.amount-in {
  color: var(--color-accent-success-text);
}

.amount-out {
  color: var(--color-text-primary);
}

/* Mobile-Karten wie auf der Kontenseite: mit Innenpadding. */
.data-table__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
}

.data-table__card-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
