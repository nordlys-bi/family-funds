<script setup lang="ts">
/*
 * Konten (ADR-0006, issue #189): wo das Geld tatsaechlich liegt.
 *
 * Ohne Konten zeigt die Seite die Einfuehrung: echte Kontostaende an einem
 * Tag eingeben, "Zu verteilen" startet dort neu. Die Vorschau zeigt vor dem
 * Bestaetigen den bisherigen und den neuen Startwert; die Differenz ist das,
 * was bisher nicht erfasst war. Danach: Liste mit Salden, weitere Konten,
 * Bearbeiten, Schliessen, Loeschen.
 *
 * Dazu "Mein Standardkonto" (issue #190): jedes Mitglied, nicht nur der Owner,
 * stellt hier ein, was bei Umschlaegen ohne Kontobindung vorausgewaehlt ist.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  ACCOUNT_TYPES,
  accountErrorText,
  accountTypeIcon,
  accountTypeLabel,
  introductionTotals,
  type AccountType,
  type IntroductionPreview,
} from '~/utils/account-options'

definePageMeta({ layout: 'default' })

type Account = {
  id: string
  name: string
  type: AccountType
  openingBalance: number
  startDate: string
  closedAt: string | null
  balance: number
  hasBookings: boolean
  /** Letzter Abgleich (#192), auch ohne Differenz. */
  lastReconciledAt: string | null
}

type Preview = IntroductionPreview & { ledgerSince: string; bookingsWithoutAccount: number }

const { activeHousehold, activeHouseholdId, canManageHousehold, fetchHouseholds } = useHousehold()
const confirm = useAskConfirm()
const currency = computed(() => activeHousehold.value?.currency ?? 'EUR')
const money = (cents: number) => formatMoneyFromCents(cents, currency.value)
const typeOptions = ACCOUNT_TYPES.map(({ value, label }) => ({ value, label }))

const accounts = ref<Account[]>([])
const ledgerSince = ref<string | null>(null)
const defaultAccountId = ref<string | null>(null)
const defaultSaving = ref(false)
const loading = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const total = computed(() => accounts.value.reduce((sum, account) => sum + account.balance, 0))
const today = () => {
  const value = new Date()
  value.setHours(12, 0, 0, 0)
  return value
}

const load = async () => {
  if (!activeHouseholdId.value) return
  loading.value = true
  try {
    const data = await $fetch<{ accounts: Account[]; ledgerSince: string; defaultAccountId: string | null }>(`/api/households/${activeHouseholdId.value}/accounts`)
    accounts.value = data.accounts
    ledgerSince.value = data.ledgerSince
    defaultAccountId.value = data.defaultAccountId
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Konten konnten nicht geladen werden: ' + accountErrorText(error) }
  } finally {
    loading.value = false
  }
}

// === Mein Standardkonto =====================================================

const defaultOptions = computed(() => [
  { label: 'Keins', value: null as string | null },
  ...accounts.value
    .filter((account) => !account.closedAt || account.id === defaultAccountId.value)
    .map((account) => ({ label: account.name, value: account.id as string | null })),
])

async function saveDefault(accountId: string | null) {
  if (!activeHouseholdId.value) return
  const previous = defaultAccountId.value
  defaultAccountId.value = accountId
  defaultSaving.value = true
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/accounts/default`, { method: 'PATCH', body: { accountId } })
    message.value = { severity: 'success', text: 'Standardkonto gespeichert.' }
  } catch (error: any) {
    defaultAccountId.value = previous
    message.value = { severity: 'error', text: 'Standardkonto konnte nicht gespeichert werden: ' + accountErrorText(error) }
  } finally {
    defaultSaving.value = false
  }
}

// === Einfuehrung ============================================================

type IntroRow = { name: string; type: AccountType; balance: number | null }

const introOpen = ref(false)
const introSaving = ref(false)
const introDate = ref<Date>(today())
const introRows = ref<IntroRow[]>([])
const introExisting = ref<number | null>(null)
const introError = ref<string | null>(null)
const preview = ref<Preview | null>(null)
const previewLoading = ref(false)

const introTotals = computed(() => preview.value ? introductionTotals(preview.value, introRows.value.map((row) => row.balance)) : null)
const introRowOptions = computed(() => introRows.value.map((row, index) => ({ label: row.name.trim() || `Konto ${index + 1}`, value: index })))
const minIntroDate = computed(() => ledgerSince.value ? new Date(ledgerSince.value) : undefined)

const openIntro = () => {
  introDate.value = today()
  introRows.value = [
    { name: 'Girokonto', type: 'CHECKING', balance: null },
    { name: 'Geldbeutel', type: 'CASH', balance: null },
  ]
  introExisting.value = null
  introError.value = null
  introOpen.value = true
  loadPreview()
}

const loadPreview = async () => {
  if (!activeHouseholdId.value) return
  previewLoading.value = true
  try {
    preview.value = await $fetch<Preview>(`/api/households/${activeHouseholdId.value}/accounts/introduction`, {
      query: { date: formatDateToInputString(introDate.value) },
    })
    if (preview.value.bookingsWithoutAccount > 0 && introExisting.value === null) introExisting.value = 0
    if (preview.value.bookingsWithoutAccount === 0) introExisting.value = null
  } catch (error: any) {
    introError.value = accountErrorText(error)
  } finally {
    previewLoading.value = false
  }
}

watch(introDate, () => { if (introOpen.value) loadPreview() })

const addIntroRow = () => { introRows.value.push({ name: '', type: 'SAVINGS', balance: null }) }
const removeIntroRow = (index: number) => {
  introRows.value.splice(index, 1)
  if (introExisting.value !== null && introExisting.value >= introRows.value.length) introExisting.value = 0
}

const saveIntro = async () => {
  if (!activeHouseholdId.value) return
  introSaving.value = true
  introError.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/accounts/introduction`, {
      method: 'POST',
      body: {
        date: formatDateToInputString(introDate.value),
        accounts: introRows.value.map((row) => ({ name: row.name, type: row.type, openingBalance: row.balance ?? 0 })),
        existingBookingsAccount: introExisting.value,
      },
    })
    introOpen.value = false
    message.value = { severity: 'success', text: 'Konten sind eingeführt. „Zu verteilen“ startet jetzt aus den Kontoständen.' }
    await Promise.all([load(), fetchHouseholds()])
  } catch (error: any) {
    introError.value = accountErrorText(error)
  } finally {
    introSaving.value = false
  }
}

// === Weiteres Konto / Bearbeiten ==========================================

type AccountForm = { name: string; type: AccountType; balance: number | null; startDate: Date; closed: boolean; closedAt: Date }

const formOpen = ref(false)
const formSaving = ref(false)
const formError = ref<string | null>(null)
const editId = ref<string | null>(null)
const form = ref<AccountForm>({ name: '', type: 'CASH', balance: null, startDate: today(), closed: false, closedAt: today() })
const editing = computed(() => accounts.value.find((account) => account.id === editId.value) ?? null)
/** Schliessen geht fruehestens am Tag nach dem Start (Stichtag exklusiv). */
const minCloseDate = computed(() => {
  if (!editing.value) return undefined
  const value = new Date(editing.value.startDate)
  value.setDate(value.getDate() + 1)
  value.setHours(12, 0, 0, 0)
  return value
})

const openCreate = () => {
  editId.value = null
  form.value = { name: '', type: 'CASH', balance: null, startDate: today(), closed: false, closedAt: today() }
  formError.value = null
  formOpen.value = true
}

const openEdit = (account: Account) => {
  editId.value = account.id
  form.value = {
    name: account.name,
    type: account.type,
    balance: account.openingBalance / 100,
    startDate: new Date(account.startDate),
    closed: account.closedAt !== null,
    closedAt: account.closedAt ? new Date(account.closedAt) : today(),
  }
  if (minCloseDate.value && form.value.closedAt < minCloseDate.value) form.value.closedAt = minCloseDate.value
  formError.value = null
  formOpen.value = true
}

const saveForm = async () => {
  if (!activeHouseholdId.value) return
  formSaving.value = true
  formError.value = null
  const base = `/api/households/${activeHouseholdId.value}/accounts`
  try {
    if (editing.value) {
      await $fetch(`${base}/${editing.value.id}`, {
        method: 'PATCH',
        body: {
          name: form.value.name,
          type: form.value.type,
          openingBalance: form.value.balance ?? 0,
          closedAt: form.value.closed ? formatDateToInputString(form.value.closedAt) : null,
        },
      })
    } else {
      await $fetch(base, {
        method: 'POST',
        body: {
          name: form.value.name,
          type: form.value.type,
          openingBalance: form.value.balance ?? 0,
          startDate: formatDateToInputString(form.value.startDate),
        },
      })
    }
    formOpen.value = false
    message.value = { severity: 'success', text: editing.value ? 'Konto wurde gespeichert.' : 'Konto wurde angelegt.' }
    await load()
  } catch (error: any) {
    formError.value = accountErrorText(error)
  } finally {
    formSaving.value = false
  }
}

const removeAccount = async (account: Account) => {
  if (!activeHouseholdId.value) return
  const ok = await confirm.ask({
    title: `${account.name} löschen?`,
    message: 'Der Anfangsbestand fällt aus „Zu verteilen“ heraus.',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/accounts/${account.id}`, { method: 'DELETE' })
    message.value = { severity: 'success', text: 'Konto wurde gelöscht.' }
    await load()
  } catch (error: any) {
    message.value = { severity: 'error', text: accountErrorText(error) }
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await load()
})
watch(activeHouseholdId, load)

// Kontouebertrag (issue #191) ueber den globalen Erfassen-Dialog; nach dem
// Speichern dort die Salden hier neu laden.
const quickCapture = useQuickCapture()
watch(quickCapture.savedTick, load)
</script>

<template>
  <ListPageShell title="Konten">
    <template #summary>
      <Tag v-if="accounts.length" severity="info" :value="`Gesamt ${money(total)}`" />
    </template>

    <template #toolbar>
      <Button
        v-if="accounts.length > 1"
        label="Übertrag"
        icon="pi pi-arrow-right-arrow-left"
        severity="secondary"
        outlined
        @click="quickCapture.open('accountTransfer')"
      />
      <Button
        v-if="accounts.length"
        label="Konto anlegen"
        icon="pi pi-plus"
        severity="success"
        :disabled="!canManageHousehold"
        @click="openCreate"
      />
    </template>

    <Message v-if="message" :severity="message.severity" variant="simple">{{ message.text }}</Message>

    <EmptyState :loading="loading" :no-household="!loading && !activeHouseholdId" loading-title="Konten werden geladen" />

    <EmptyState
      v-if="!loading && activeHouseholdId && accounts.length === 0"
      variant="first-time"
      icon="pi pi-credit-card"
      icon-tone="accent"
      headline="Wo liegt euer Geld?"
      description="Umschläge sagen, wofür Geld da ist. Konten sagen, wo es liegt: Girokonto, Geldbeutel, Sparkonto. Mit den echten Kontoständen startet „Zu verteilen“ neu, und die Rechnung wird prüfbar."
      :cta="canManageHousehold ? { label: 'Konten einführen', onClick: openIntro, severity: 'primary' } : undefined"
    />
    <Message v-if="!loading && accounts.length === 0 && !canManageHousehold" severity="warn" variant="simple">
      Nur Owner können Konten einführen.
    </Message>

    <ListPanel v-if="!loading && accounts.length" title="Konten" compact :badge="`${accounts.length}`">
      <ListTable dense accent="primary">
        <template #head>
          <th>Konto</th>
          <th class="muted">Art</th>
          <th class="muted">Seit</th>
          <th class="num">Saldo</th>
          <th class="actions"></th>
        </template>

        <tr v-for="account in accounts" :key="account.id" :class="{ 'account-row--closed': account.closedAt }">
          <td class="name">
            <span class="account-cell">
              <i :class="accountTypeIcon(account.type)" aria-hidden="true"></i>
              <NuxtLink :to="`/households/accounts/${account.id}`" class="account-link">{{ account.name }}</NuxtLink>
            </span>
            <span v-if="account.closedAt" class="sub">geschlossen ab {{ formatPlanningDate(account.closedAt) }}</span>
            <span v-else-if="account.lastReconciledAt" class="sub">abgeglichen am {{ formatPlanningDate(account.lastReconciledAt) }}</span>
          </td>
          <td class="muted">{{ accountTypeLabel(account.type) }}</td>
          <td class="muted account-date">{{ formatPlanningDate(account.startDate) }}</td>
          <td class="num" :class="{ 'account-negative': account.balance < 0 }">{{ money(account.balance) }}</td>
          <td class="actions">
            <Button
              icon="pi pi-pen-to-square"
              severity="secondary"
              text
              size="small"
              aria-label="Konto bearbeiten"
              :disabled="!canManageHousehold"
              @click="openEdit(account)"
            />
            <Button
              v-if="!account.hasBookings"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              aria-label="Konto löschen"
              :disabled="!canManageHousehold"
              @click="removeAccount(account)"
            />
          </td>
        </tr>

        <template #mobile>
          <div v-for="account in accounts" :key="`m-${account.id}`" class="data-table__card">
            <div class="data-table__card-line">
              <span class="data-table__card-name account-cell">
                <i :class="accountTypeIcon(account.type)" aria-hidden="true"></i>
                <NuxtLink :to="`/households/accounts/${account.id}`" class="account-link">{{ account.name }}</NuxtLink>
              </span>
              <span :class="{ 'account-negative': account.balance < 0 }">{{ money(account.balance) }}</span>
            </div>
            <div class="data-table__card-meta">
              <span>{{ accountTypeLabel(account.type) }}</span>
              <span>·</span>
              <span>seit {{ formatPlanningDate(account.startDate) }}</span>
              <template v-if="account.closedAt">
                <span>·</span>
                <span>geschlossen ab {{ formatPlanningDate(account.closedAt) }}</span>
              </template>
              <template v-else-if="account.lastReconciledAt">
                <span>·</span>
                <span>abgeglichen am {{ formatPlanningDate(account.lastReconciledAt) }}</span>
              </template>
            </div>
            <div v-if="canManageHousehold" class="data-table__card-actions">
              <Button icon="pi pi-pen-to-square" severity="secondary" text size="small" aria-label="Konto bearbeiten" @click="openEdit(account)" />
              <Button
                v-if="!account.hasBookings"
                icon="pi pi-trash"
                severity="danger"
                text
                size="small"
                aria-label="Konto löschen"
                @click="removeAccount(account)"
              />
            </div>
          </div>
        </template>
      </ListTable>
    </ListPanel>

    <ListPanel v-if="!loading && accounts.length" title="Mein Standardkonto" compact>
      <div class="default-account">
        <Select
          input-id="default-account"
          :model-value="defaultAccountId"
          :options="defaultOptions"
          option-label="label"
          option-value="value"
          :loading="defaultSaving"
          placeholder="Keins"
          aria-label="Mein Standardkonto"
          class="default-account__select"
          @update:model-value="saveDefault"
        />
        <small class="default-account__hint">
          Bei der Erfassung vorausgewählt, wenn der Umschlag an kein Konto gebunden ist. Gilt nur für dich.
        </small>
      </div>
    </ListPanel>

    <FormDialog
      v-model:visible="introOpen"
      header="Konten einführen"
      submit-label="Einführen"
      :saving="introSaving"
      @save="saveIntro"
      @cancel="introOpen = false"
      width="min(44rem, 94vw)"
    >
      <p class="account-hint">
        Trag die echten Stände aller Konten zu Beginn des Tages ein. Ab diesem Tag braucht jede Buchung ein Konto,
        und „Zu verteilen“ startet mit dem Geld, das auf den Konten liegt und noch in keinem Umschlag steckt.
      </p>
      <FormFieldRow label="Stand zu Beginn von" html-for="intro-date" wide>
        <DatePicker
          id="intro-date"
          v-model="introDate"
          show-icon
          date-format="dd.mm.yy"
          :max-date="today()"
          :min-date="minIntroDate"
        />
      </FormFieldRow>

      <div class="intro-rows">
        <div v-for="(row, index) in introRows" :key="index" class="intro-row">
          <InputText v-model="row.name" :aria-label="`Name von Konto ${index + 1}`" placeholder="Name" />
          <Select v-model="row.type" :options="typeOptions" option-label="label" option-value="value" :aria-label="`Art von Konto ${index + 1}`" />
          <MoneyInput v-model="row.balance" :currency="currency" placeholder="Stand" />
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            :aria-label="`Konto ${index + 1} entfernen`"
            :disabled="introRows.length <= 1"
            @click="removeIntroRow(index)"
          />
        </div>
        <Button label="Konto hinzufügen" icon="pi pi-plus" severity="secondary" text size="small" @click="addIntroRow" />
      </div>

      <FormFieldRow
        v-if="preview && preview.bookingsWithoutAccount > 0"
        :label="`${preview.bookingsWithoutAccount} Buchung(en) ab diesem Tag gehören zu`"
        html-for="intro-existing"
        wide
      >
        <Select id="intro-existing" v-model="introExisting" :options="introRowOptions" option-label="label" option-value="value" />
      </FormFieldRow>

      <div v-if="preview && introTotals" class="intro-preview" aria-live="polite">
        <div class="intro-preview__row">
          <span>Auf den Konten</span>
          <strong>{{ money(introTotals.accounts) }}</strong>
        </div>
        <div class="intro-preview__row">
          <span>davon schon in Umschlägen</span>
          <strong>{{ money(preview.envelopesBefore) }}</strong>
        </div>
        <div class="intro-preview__row intro-preview__row--main">
          <span>„Zu verteilen“ neu</span>
          <strong :class="{ 'account-negative': introTotals.unassigned < 0 }">{{ money(introTotals.unassigned) }}</strong>
        </div>
        <div class="intro-preview__row intro-preview__row--muted">
          <span>bisher</span>
          <span>{{ money(preview.unassignedBefore) }}</span>
        </div>
        <p class="account-hint">
          <template v-if="introTotals.difference > 0">{{ money(introTotals.difference) }} mehr als bisher: Geld, das bisher nicht erfasst war.</template>
          <template v-else-if="introTotals.difference < 0">{{ money(-introTotals.difference) }} weniger als bisher: Ausgaben, die bisher nicht erfasst waren.</template>
          <template v-else>Genau wie bisher.</template>
        </p>
      </div>
      <p v-else-if="previewLoading" class="account-hint">Vorschau wird berechnet …</p>

      <Message v-if="introError" severity="error" variant="simple">{{ introError }}</Message>
    </FormDialog>

    <FormDialog
      v-model:visible="formOpen"
      :header="editing ? 'Konto bearbeiten' : 'Konto anlegen'"
      :submit-label="editing ? 'Speichern' : 'Anlegen'"
      :saving="formSaving"
      @save="saveForm"
      @cancel="formOpen = false"
      width="min(34rem, 94vw)"
    >
      <FormFieldRow label="Name" html-for="account-name" wide>
        <InputText id="account-name" v-model="form.name" placeholder="z. B. Sparschwein" />
      </FormFieldRow>
      <FormFieldRow label="Art" html-for="account-type" wide>
        <Select id="account-type" v-model="form.type" :options="typeOptions" option-label="label" option-value="value" />
      </FormFieldRow>
      <FormFieldRow :label="editing ? 'Anfangsbestand' : 'Stand zu Beginn'" html-for="account-balance">
        <MoneyInput id="account-balance" v-model="form.balance" :currency="currency" />
        <small class="account-hint">
          <template v-if="editing">Eine Korrektur verschiebt „Zu verteilen“ um denselben Betrag.</template>
          <template v-else>Dieses Geld kommt zu „Zu verteilen“ hinzu.</template>
        </small>
      </FormFieldRow>
      <FormFieldRow v-if="!editing" label="Seit" html-for="account-start">
        <DatePicker
          id="account-start"
          v-model="form.startDate"
          show-icon
          date-format="dd.mm.yy"
          :max-date="today()"
          :min-date="minIntroDate"
        />
      </FormFieldRow>
      <template v-if="editing">
        <FormFieldRow label="Geschlossen" html-for="account-closed" wide>
          <ToggleSwitch input-id="account-closed" v-model="form.closed" />
        </FormFieldRow>
        <FormFieldRow v-if="form.closed" label="Ab" html-for="account-closed-at">
          <DatePicker id="account-closed-at" v-model="form.closedAt" show-icon date-format="dd.mm.yy" :min-date="minCloseDate" />
          <small class="account-hint">Ab diesem Tag nimmt das Konto keine Buchungen mehr an.</small>
        </FormFieldRow>
      </template>
      <Message v-if="formError" severity="error" variant="simple">{{ formError }}</Message>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
/* Mobile-Karten wie auf der Mitgliederseite (issue #132): flach, aber mit
   Innenpadding, sonst kleben Icon und Saldo am Bildschirmrand. */
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

.default-account {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
}

.default-account__select {
  max-width: 20rem;
}

.default-account__hint {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.account-link {
  color: inherit;
  text-decoration: none;
}

.account-link:hover,
.account-link:focus-visible {
  text-decoration: underline;
}

.account-cell {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.account-cell i {
  color: var(--color-text-muted);
}

.account-date {
  white-space: nowrap;
}

.account-row--closed td {
  opacity: 0.6;
}

.account-negative {
  color: var(--color-danger, #dc2626);
}

.account-hint {
  display: block;
  margin: 0 0 0.75rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.intro-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0;
}

.intro-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
}

@media (max-width: 639px) {
  .intro-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  }

  .intro-row > :first-child {
    grid-column: 1 / -1;
  }
}

.intro-preview {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
}

.intro-preview__row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
}

.intro-preview__row--main {
  padding-top: 0.35rem;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 1rem;
}

.intro-preview__row--muted {
  color: var(--color-text-muted);
}

.intro-preview .account-hint {
  margin: 0.35rem 0 0;
}
</style>
