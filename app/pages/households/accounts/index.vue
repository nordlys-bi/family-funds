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
 * Status zuerst (issue #198): Oben steht, was zu tun ist (fehlt Geld, liegt
 * Geld unverplant auf dem Sparkonto, ist ein Abgleich ueberfaellig), jeweils
 * mit Aktion. Die Konten darunter sind nach Gruppen gegliedert, die ueber
 * Bindungen zusammenhaengen; der Gruppenkopf zeigt ihre Deckung
 * (`account-coverage.ts`).
 *
 * Dazu "Mein Standardkonto" (issue #190): jedes Mitglied, nicht nur der Owner,
 * stellt hier ein, was bei Umschlaegen ohne Kontobindung vorausgewaehlt ist.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  ACCOUNT_TYPES,
  accountErrorText,
  accountTypeIcon,
  introductionTotals,
  type AccountType,
  type IntroductionPreview,
} from '~/utils/account-options'
import { buildBalanceSheet, computeAccountStatus, type StatusAccount } from '~/utils/account-coverage'
import { isEnvelopeOpenOn } from '~/utils/envelope-options'
import type { EnvelopeItem, UnassignedOverview } from '~/types/envelope'

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
const currency = computed(() => activeHousehold.value?.currency ?? 'EUR')
const money = (cents: number) => formatMoneyFromCents(cents, currency.value)
const typeOptions = ACCOUNT_TYPES.map(({ value, label }) => ({ value, label }))

const accounts = ref<Account[]>([])
const ledgerSince = ref<string | null>(null)
const defaultAccountId = ref<string | null>(null)
const envelopes = ref<EnvelopeItem[]>([])
const unassigned = ref<UnassignedOverview | null>(null)
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
    const [data, overview] = await Promise.all([
      $fetch<{ accounts: Account[]; ledgerSince: string; defaultAccountId: string | null }>(`/api/households/${activeHouseholdId.value}/accounts`),
      // Fuer die Deckung; schlaegt das fehl, fehlt nur dieser Block.
      $fetch<{ envelopes: EnvelopeItem[]; unassigned: UnassignedOverview }>(`/api/households/${activeHouseholdId.value}/envelopes`).catch(() => null),
    ])
    accounts.value = data.accounts
    ledgerSince.value = data.ledgerSince
    defaultAccountId.value = data.defaultAccountId
    envelopes.value = overview?.envelopes ?? []
    unassigned.value = overview?.unassigned ?? null
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Konten konnten nicht geladen werden: ' + accountErrorText(error) }
  } finally {
    loading.value = false
  }
}

// === Status und Gruppen (issue #198) =======================================
// Geschlossene Umschlaege zaehlen nicht: Ihr Saldo steckt im Ziel.
const status = computed(() =>
  computeAccountStatus(
    accounts.value as StatusAccount[],
    envelopes.value
      .filter((envelope) => isEnvelopeOpenOn(envelope))
      .map((envelope) => ({
        id: envelope.id,
        name: envelope.name,
        balance: envelope.balance.balance,
        reserved: envelope.reserved,
        accountIds: envelope.accountIds ?? [],
        group: envelope.group,
      })),
    today(),
  ),
)
const accountNames = computed(() => Object.fromEntries(accounts.value.map((account) => [account.id, account.name])))

/**
 * Bilanz je Gruppe (#198): links Konten, rechts Umschlaege, unten gleiche
 * Summe. Ohne Bindungen gibt es keine Gruppen, die etwas sagen; dann eine
 * schlichte Kontenliste.
 */
const sheets = computed(() => {
  const byId = new Map(accounts.value.map((account) => [account.id, account]))
  const { coverage, findings, groupLabels, groupStatus, homeIndex } = status.value
  return coverage.groups.map((group, index) => {
    const accountIds = new Set(group.accounts.map((account) => account.id))
    const missing = findings.find((finding) =>
      finding.kind === 'missing' && finding.transfer && accountIds.has(finding.transfer.toAccountId))
    return {
      key: group.accounts[0]!.id,
      label: groupLabels[index]!,
      state: groupStatus[index]!,
      sheet: buildBalanceSheet(group, index === homeIndex),
      accounts: group.accounts.map((account) => byId.get(account.id)!),
      transfer: missing?.kind === 'missing' ? missing.transfer : null,
      includesUnbound: index === homeIndex && coverage.unbound.envelopes.length > 0,
    }
  })
})
const showSheets = computed(() => Boolean(unassigned.value) && status.value.coverage.hasBindings)
// Konten in keiner gezeigten Gruppe (leer und geschlossen).
const accountsOutsideSheets = computed(() => {
  const shown = new Set(sheets.value.flatMap((sheet) => sheet.accounts.map((account) => account.id)))
  return accounts.value.filter((account) => !shown.has(account.id))
})
const overdueIds = computed(() =>
  status.value.findings.flatMap((finding) => (finding.kind === 'reconcile' ? [finding.accountId] : [])),
)

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

// === Weiteres Konto ==========================================================
// Bearbeiten, Schliessen und Loeschen sind auf der Kontoseite (#198).
const formOpen = ref(false)
const openCreate = () => { formOpen.value = true }

async function onAccountSaved(text: string) {
  message.value = { severity: 'success', text }
  await load()
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

    <AccountStatusCard
      v-if="!loading && accounts.length && unassigned"
      :status="status"
      :account-names="accountNames"
      :currency="currency"
    />

    <template v-if="!loading && accounts.length">
      <div v-if="showSheets" class="sheets">
        <p class="sheets__intro">Beide Seiten zeigen dasselbe Geld, nur anders sortiert: links, wo es liegt, rechts, wofür es gedacht ist.</p>
        <AccountBalanceSheet
          v-for="item in sheets"
          :key="item.key"
          :label="item.label"
          :state="item.state"
          :sheet="item.sheet"
          :accounts="item.accounts"
          :overdue-ids="overdueIds"
          :transfer="item.transfer"
          :account-names="accountNames"
          :currency="currency"
          :includes-unbound="item.includesUnbound"
        />
        <div class="sheets__footer">
          <span v-if="status.coverage.unbound.envelopes.length">
            Ohne Kontobindung: {{ status.coverage.unbound.envelopes.length }} Umschläge {{ money(status.coverage.unbound.total) }}.
            Ihr Geld steckt in „Zu verteilen“ bzw. „unverplant“ oben.
          </span>
          <details class="sheets__how">
            <summary>Wie gerechnet?</summary>
            <p>
              Konten, die über gebundene Umschläge zusammenhängen, bilden eine Gruppe. Je Gruppe stehen links die
              Kontostände, rechts die Umschläge. Freies Geld („Zu verteilen“) gehört zu
              {{ status.homeIndex >= 0 ? status.groupLabels[status.homeIndex] : 'den Alltagskonten' }}; liegt anderswo
              mehr, als die Umschläge brauchen, ist es „unverplant“. Fehlt Geld, steht das links. Welcher Euro eines
              Umschlags auf welchem Konto liegt, rechnet die App bewusst nicht aus.
            </p>
          </details>
        </div>
      </div>

      <ListPanel
        v-if="!showSheets || accountsOutsideSheets.length"
        :title="showSheets ? 'Weitere Konten' : 'Konten'"
        compact
        :badge="`${showSheets ? accountsOutsideSheets.length : accounts.length}`"
      >
        <ul class="plain-accounts">
          <li v-for="account in showSheets ? accountsOutsideSheets : accounts" :key="account.id" :class="{ 'account-row--closed': account.closedAt }">
            <span class="account-cell">
              <i :class="accountTypeIcon(account.type)" aria-hidden="true"></i>
              <NuxtLink :to="`/households/accounts/${account.id}`" class="account-link">{{ account.name }}</NuxtLink>
              <span v-if="account.closedAt" class="plain-accounts__meta">geschlossen ab {{ formatPlanningDate(account.closedAt) }}</span>
              <span v-else-if="overdueIds.includes(account.id)" class="plain-accounts__tag">Abgleich fällig</span>
            </span>
            <span :class="['plain-accounts__amount', { 'account-negative': account.balance < 0 }]">{{ money(account.balance) }}</span>
          </li>
        </ul>
      </ListPanel>
    </template>

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

    <AccountFormDialog
      v-if="activeHouseholdId"
      v-model:visible="formOpen"
      :household-id="activeHouseholdId"
      :currency="currency"
      :min-start-date="minIntroDate"
      @saved="onAccountSaved"
    />
  </ListPageShell>
</template>

<style scoped>
.sheets {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sheets__intro {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.sheets__footer {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.sheets__how summary {
  cursor: pointer;
}

.sheets__how p {
  max-width: 42rem;
  margin: 6px 0 0;
}

.plain-accounts {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plain-accounts li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-subtle);
}

.plain-accounts li:first-child {
  border-top: 0;
}

.plain-accounts__meta {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.plain-accounts__tag {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--color-accent-warning-soft);
  color: var(--color-accent-warning-text);
  font-size: 0.7rem;
  font-weight: 600;
}

.plain-accounts__amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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

.account-row--closed {
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
