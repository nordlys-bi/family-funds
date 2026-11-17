<!--
  Kontoseite (ADR-0006, issue #191): wo das Geld liegt und wie es dorthin kam.

  Saldo von heute und alle Bewegungen ab dem Start des Kontos, neueste
  zuerst, jeweils mit dem Saldo danach: Anfangsbestand, Ausgaben, Einnahmen
  und Kontouebertraege. Uebertraege lassen sich hier aendern (Betrag, Datum,
  Notiz) und loeschen; Ausgaben und Einnahmen bearbeitet man in der
  Buchungsliste. Der Abgleich (#192) dockt spaeter hier an.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { accountErrorText, accountTypeIcon, accountTypeLabel, type AccountType } from '~/utils/account-options'

definePageMeta({ layout: 'default' })

type HistoryEntry = {
  type: 'opening' | 'income' | 'expense' | 'transfer'
  id: string | null
  date: string
  amount: number
  text: string | null
  envelopeName: string | null
  counterpartId: string | null
  counterpartName: string | null
  userName: string | null
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
            </div>
          </template>
        </ListTable>
      </ListPanel>
    </ListPageShell>

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
