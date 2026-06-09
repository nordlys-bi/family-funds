<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({
  layout: 'default',
})

type TransactionKind = 'expense' | 'income'

type BudgetVersionItem = {
  id: string
  amount: number
  frequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'
  validFrom: string
  createdAt: string
  updatedAt: string
}

type BudgetItem = {
  id: string
  key: string
  name: string
  createdAt: string
  updatedAt: string
  versions: BudgetVersionItem[]
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
}

type TransactionItem = {
  id: string
  kind: TransactionKind
  amount: number
  description: string | null
  date: string
  createdAt: string
  updatedAt: string
  budgetId?: string | null
  budgetName?: string | null
  budgetKey?: string | null
  user: {
    id: string
    displayName: string | null
    email: string
  }
}

type TransactionSummary = {
  incomeTotal: number
  expenseTotal: number
  netTotal: number
  unassignedExpenseTotal: number
}

type TransactionFormState = {
  kind: TransactionKind
  amount: number | null
  description: string
  date: Date | null
  budgetId: string
}

type SelectOption<T extends string> = {
  label: string
  value: T
}

const { activeHousehold, fetchHouseholds } = useHousehold()

const currentHousehold = ref<PlanningHousehold | null>(null)
const transactions = ref<TransactionItem[]>([])
const summary = ref<TransactionSummary>({
  incomeTotal: 0,
  expenseTotal: 0,
  netTotal: 0,
  unassignedExpenseTotal: 0,
})
const loading = ref(false)
const transactionLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const notice = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)
const editingTransactionId = ref<string | null>(null)
const transactionDialogOpen = ref(false)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')
const transactionTypeOptions: SelectOption<TransactionKind>[] = [
  { label: 'Ausgabe', value: 'expense' },
  { label: 'Einnahme', value: 'income' },
]

const moneyFormatter = computed(
  () =>
    new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currencyCode.value,
    }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const transactionForm = ref({
  kind: 'expense' as TransactionKind,
  amount: null as number | null,
  description: '',
  date: new Date(),
  budgetId: '',
})

const budgetOptions = computed(() => currentHousehold.value?.budgets ?? [])
const budgetSelectOptions = computed(() => [
  { label: 'Sonstiges', value: '' },
  ...budgetOptions.value.map((budget) => ({
    label: budget.name,
    value: budget.id,
  })),
])
const expenseTransactions = computed(() => transactions.value.filter((transaction) => transaction.kind === 'expense'))
const incomeTransactions = computed(() => transactions.value.filter((transaction) => transaction.kind === 'income'))
const expenseCount = computed(() => expenseTransactions.value.length)
const incomeCount = computed(() => incomeTransactions.value.length)
const monthBalance = computed(() => summary.value.netTotal)

const loadData = async () => {
  loading.value = true
  notice.value = null
  try {
    const [current, tx] = await Promise.all([
      $fetch<{ household: PlanningHousehold | null }>('/api/households/current'),
      activeHouseholdId.value
        ? $fetch<{ transactions: TransactionItem[]; summary: TransactionSummary }>(
            `/api/households/${activeHouseholdId.value}/transactions`,
          )
        : Promise.resolve(null),
    ])

    currentHousehold.value = current.household
    if (tx) {
      transactions.value = tx.transactions
      summary.value = tx.summary
    } else {
      transactions.value = []
      summary.value = {
        incomeTotal: 0,
        expenseTotal: 0,
        netTotal: 0,
        unassignedExpenseTotal: 0,
      }
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Transaktionen konnten nicht geladen werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  transactionForm.value = {
    kind: 'expense',
    amount: null,
    description: '',
    date: new Date(),
    budgetId: '',
  }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => {
  resetForm()
  transactionDialogOpen.value = true
}

const editTransaction = (transaction: TransactionItem) => {
  editingTransactionId.value = transaction.id
  transactionForm.value = {
    kind: transaction.kind,
    amount: transaction.amount / 100,
    description: transaction.description ?? '',
    date: new Date(transaction.date),
    budgetId: transaction.kind === 'expense' ? transaction.budgetId ?? '' : '',
  }
}

const openEditTransactionDialog = (transaction: TransactionItem) => {
  editTransaction(transaction)
  transactionDialogOpen.value = true
}

const closeTransactionDialog = () => {
  transactionDialogOpen.value = false
  resetForm()
}

const saveTransaction = async () => {
  if (!activeHouseholdId.value) return

  transactionLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(editingTransactionId.value)
    const payload = {
      kind: transactionForm.value.kind,
      ...(editingTransactionId.value ? { id: editingTransactionId.value } : {}),
      amount: transactionForm.value.amount ?? undefined,
      description: transactionForm.value.description,
      date: transactionForm.value.date ? formatDateInput(transactionForm.value.date) : undefined,
      ...(transactionForm.value.kind === 'expense' ? { budgetId: transactionForm.value.budgetId || null } : {}),
    }

    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: editingTransactionId.value ? 'PATCH' : 'POST',
      body: payload,
    })

    await loadData()
    closeTransactionDialog()
    notice.value = {
      severity: 'success',
      text: isEdit ? 'Transaktion wurde aktualisiert.' : 'Transaktion wurde angelegt.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Transaktion konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    transactionLoading.value = false
  }
}

const deleteTransaction = async (transaction: TransactionItem) => {
  if (!activeHouseholdId.value) return

  actionLoadingKey.value = `${transaction.kind}:${transaction.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'DELETE',
      body: {
        kind: transaction.kind,
        id: transaction.id,
      },
    })

    await loadData()
    notice.value = {
      severity: 'success',
      text: 'Transaktion wurde gelöscht.',
    }
  } catch (error: any) {
    notice.value = {
      severity: 'error',
      text: 'Transaktion konnte nicht gelöscht werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    actionLoadingKey.value = null
  }
}

const transactionTypeLabel = (kind: TransactionKind) => (kind === 'expense' ? 'Ausgabe' : 'Einnahme')
const transactionTypeTone = (kind: TransactionKind) => (kind === 'income' ? 'success' : 'info')

const budgetLabel = (transaction: TransactionItem) => {
  if (transaction.kind === 'income') return 'Ohne Budget'
  return transaction.budgetName ?? 'Sonstiges'
}

useDesktopShortcut('n', () => {
  if (!activeHouseholdId.value || transactionDialogOpen.value) return
  openCreateTransactionDialog()
})

onMounted(async () => {
  await fetchHouseholds()
  await loadData()
})

watch(activeHouseholdId, async () => {
  await loadData()
})
</script>

<template>
  <ListPageShell
    eyebrow="Meilenstein 5"
    title="Transaktionen"
    description="Erfasse Ausgaben und Einnahmen für den aktiven Haushalt. Ausgaben landen optional direkt in einem Budget, sonst bei Sonstiges."
  >
    <template #summary>
      <Tag severity="info" :value="`Einnahmen ${formatMoney(summary.incomeTotal)}`" />
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(summary.expenseTotal)}`" />
      <Tag severity="success" :value="`Saldo ${formatMoney(monthBalance)}`" />
      <Tag severity="secondary" :value="`Ohne Budget ${formatMoney(summary.unassignedExpenseTotal)}`" />
    </template>

    <template #toolbar>
      <div class="toolbar-note">
        <span class="toolbar-note__label">Neu</span>
        <Tag value="N" severity="secondary" rounded />
      </div>
      <Button label="Neu" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <section v-if="loading" class="empty-state">
      <div class="empty-state__card">
        <p class="empty-state__eyebrow">Lädt</p>
        <h2>Transaktionen werden geladen</h2>
        <p>Wir holen den aktiven Haushalt und die Buchungen des aktuellen Monats.</p>
      </div>
    </section>

    <section v-else-if="!activeHousehold" class="empty-state">
      <div class="empty-state__card">
        <p class="empty-state__eyebrow">Kein Haushalt aktiv</p>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Erst dann können wir Transaktionen erfassen.</p>
        <NuxtLink to="/households" class="empty-state__button">Zu den Haushalten</NuxtLink>
      </div>
    </section>

    <section v-else class="list-panel">
      <div class="list-panel__head">
        <div>
          <p class="list-panel__kicker">Monat</p>
          <h2>Aktuelle Buchungen</h2>
        </div>
        <span class="panel-badge">{{ formatMoney(summary.netTotal) }}</span>
      </div>

      <div class="item-list">
        <article v-for="transaction in transactions" :key="transaction.id" class="item-card">
          <div class="item-main">
            <div class="item-title-row">
              <h3>{{ transaction.description || transactionTypeLabel(transaction.kind) }}</h3>
              <Tag :severity="transactionTypeTone(transaction.kind)" :value="formatMoney(transaction.amount)" class="item-pill" />
            </div>
            <div class="item-meta-row">
              <Tag
                :severity="transaction.kind === 'income' ? 'success' : 'info'"
                :value="transactionTypeLabel(transaction.kind)"
                class="item-tag"
              />
              <Tag
                severity="secondary"
                :value="budgetLabel(transaction)"
                class="item-tag"
              />
            </div>
            <p>
              {{ formatDate(transaction.date) }}
            </p>
            <p class="transaction-meta">
              Von {{ transaction.user.displayName || transaction.user.email }}
            </p>
          </div>
          <div class="item-actions">
            <Button
              type="button"
              label="Bearbeiten"
              icon="pi pi-pen-to-square"
              severity="secondary"
              outlined
              size="small"
              @click="openEditTransactionDialog(transaction)"
            />
            <Button
              type="button"
              label="Löschen"
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              :loading="actionLoadingKey === `${transaction.kind}:${transaction.id}`"
              @click="deleteTransaction(transaction)"
            />
          </div>
        </article>

        <div v-if="transactions.length === 0" class="empty-list">Noch keine Transaktionen angelegt.</div>
      </div>
    </section>

    <Dialog
      v-model:visible="transactionDialogOpen"
      modal
      :header="editingTransactionId ? 'Transaktion bearbeiten' : 'Neue Transaktion'"
      :style="{ width: 'min(44rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeTransactionDialog"
    >
      <form class="transaction-dialog" @submit.prevent="saveTransaction">
        <div class="field field--wide">
          <label for="transaction-kind">Typ</label>
          <Select
            id="transaction-kind"
            v-model="transactionForm.kind"
            :options="transactionTypeOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="transaction-amount">Betrag</label>
          <InputNumber
            id="transaction-amount"
            v-model="transactionForm.amount"
            mode="currency"
            :currency="currencyCode"
            locale="de-DE"
            class="w-full"
            inputClass="w-full"
            :minFractionDigits="2"
            :maxFractionDigits="2"
            placeholder="0,00"
          />
        </div>
        <div class="field">
          <label for="transaction-date">Datum</label>
          <DatePicker
            id="transaction-date"
            v-model="transactionForm.date"
            dateFormat="dd.mm.yy"
            showIcon
            class="w-full"
            inputClass="w-full"
          />
        </div>
        <div class="field field--wide">
          <label for="transaction-description">Beschreibung</label>
          <InputText
            id="transaction-description"
            v-model="transactionForm.description"
            class="w-full"
            placeholder="z. B. Einkauf bei Rewe"
          />
        </div>
        <div v-if="transactionForm.kind === 'expense'" class="field field--wide">
          <label for="transaction-budget">Budget</label>
          <Select
            id="transaction-budget"
            v-model="transactionForm.budgetId"
            :options="budgetSelectOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>

        <div class="dialog-actions">
          <Button
            type="button"
            label="Abbrechen"
            severity="secondary"
            outlined
            @click="closeTransactionDialog"
          />
          <Button
            type="submit"
            :label="editingTransactionId ? 'Transaktion aktualisieren' : 'Transaktion anlegen'"
            icon="pi pi-check"
            :loading="transactionLoading"
          />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.list-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.list-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.list-panel__kicker {
  margin: 0 0 0.25rem;
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.toolbar-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #cbd5e1;
}

.toolbar-note__label {
  font-size: 0.85rem;
  color: #94a3b8;
}

.dialog-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.35rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.field--wide {
  grid-column: 1 / -1;
}

.field label {
  color: #e2e8f0;
  font-size: 0.88rem;
  font-weight: 700;
}

.transaction-dialog {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.95rem;
}

.transaction-meta {
  color: #cbd5e1;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.82);
}

.item-main {
  min-width: 0;
  flex: 1 1 auto;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.item-title-row h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.item-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.item-main p {
  margin: 0.35rem 0 0;
  color: #94a3b8;
  font-size: 0.88rem;
  line-height: 1.45;
}

.item-pill {
  white-space: nowrap;
}

.item-tag {
  font-size: 0.76rem;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.empty-list {
  color: #94a3b8;
  text-align: center;
  padding: 1.25rem 0.75rem;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.5);
}

:deep(.p-inputtext),
:deep(.p-select),
:deep(.p-datepicker-input),
:deep(.p-inputnumber-input) {
  width: 100%;
}

:deep(.p-select),
:deep(.p-datepicker),
:deep(.p-inputnumber) {
  width: 100%;
}

:deep(.p-button) {
  border-radius: 14px;
}

:deep(.p-tag) {
  border-radius: 999px;
}

@media (max-width: 1120px) {
  .transaction-dialog {
    grid-template-columns: 1fr;
  }

  .item-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .item-actions {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
}
</style>
