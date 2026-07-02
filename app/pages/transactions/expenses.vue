<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type BudgetItem = {
  id: string
  key: string
  name: string
}

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: BudgetItem[]
}

type TransactionItem = {
  id: string
  kind: 'expense' | 'income'
  amount: number
  description: string | null
  date: string
  budgetId?: string | null
  budgetName?: string | null
  user: { displayName: string | null; email: string }
}

type TransactionSummary = {
  incomeTotal: number
  expenseTotal: number
  netTotal: number
  unassignedExpenseTotal: number
}

const { activeHousehold, fetchHouseholds } = useHousehold()

const currentHousehold = ref<PlanningHousehold | null>(null)
const transactions = ref<TransactionItem[]>([])
const summary = ref<TransactionSummary>({ incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 })
const loading = ref(false)
const transactionLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)
const notice = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)
const editingTransactionId = ref<string | null>(null)
const transactionDialogOpen = ref(false)

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => currentHousehold.value?.currency ?? activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)

const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

const transactionForm = ref({
  amount: null as number | null,
  description: '',
  date: new Date(),
  budgetId: '',
})

const budgetOptions = computed(() => currentHousehold.value?.budgets ?? [])
const budgetSelectOptions = computed(() => [
  { label: 'Sonstiges', value: '' },
  ...budgetOptions.value.map((budget) => ({ label: budget.name, value: budget.id })),
])

const visibleTransactions = computed(() => transactions.value.filter((transaction) => transaction.kind === 'expense'))
const budgetLabel = (transaction: TransactionItem) => transaction.budgetName ?? 'Sonstiges'

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
      summary.value = { incomeTotal: 0, expenseTotal: 0, netTotal: 0, unassignedExpenseTotal: 0 }
    }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Transaktionen konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  transactionForm.value = { amount: null, description: '', date: new Date(), budgetId: '' }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const editTransaction = (transaction: TransactionItem) => {
  editingTransactionId.value = transaction.id
  transactionForm.value = {
    amount: transaction.amount / 100,
    description: transaction.description ?? '',
    date: new Date(transaction.date),
    budgetId: transaction.budgetId ?? '',
  }
  transactionDialogOpen.value = true
}

const closeTransactionDialog = () => { transactionDialogOpen.value = false; resetForm() }

const saveTransaction = async () => {
  if (!activeHouseholdId.value) return
  transactionLoading.value = true
  notice.value = null
  try {
    const isEdit = Boolean(editingTransactionId.value)
    const payload = {
      kind: 'expense' as const,
      ...(editingTransactionId.value ? { id: editingTransactionId.value } : {}),
      amount: transactionForm.value.amount ?? undefined,
      description: transactionForm.value.description,
      date: transactionForm.value.date ? formatDateInput(transactionForm.value.date) : undefined,
      budgetId: transactionForm.value.budgetId || null,
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: editingTransactionId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadData()
    closeTransactionDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Ausgabe wurde aktualisiert.' : 'Ausgabe wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Ausgabe konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    transactionLoading.value = false
  }
}

const deleteTransaction = async (transaction: TransactionItem) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `expense:${transaction.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'DELETE',
      body: { kind: 'expense', id: transaction.id },
    })
    await loadData()
    notice.value = { severity: 'success', text: 'Ausgabe wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Ausgabe konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadData()
})
watch(activeHouseholdId, async () => { await loadData() })
</script>

<template>
  <ListPageShell
    eyebrow="Meilenstein 5 / Ausgaben"
    title="Ausgaben"
    description="Erfasse alle Ausgaben für den aktuellen Monat. Weise sie optional einem Budget zu oder lass sie unter Sonstiges laufen."
  >
    <template #summary>
      <Tag severity="warning" :value="`Ausgaben ${formatMoney(summary.expenseTotal)}`" />
      <Tag severity="secondary" :value="`Ohne Budget ${formatMoney(summary.unassignedExpenseTotal)}`" />
      <Tag severity="info" :value="`${visibleTransactions.length} Buchungen`" />
    </template>

    <template #toolbar>
      <Button label="Ausgabe anlegen" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Ausgaben werden geladen"
    />

    <ListPanel
      v-if="!loading && activeHousehold && currentHousehold"
      kicker="Monat"
      title="Aktuelle Ausgaben"
      :badge="formatMoney(summary.expenseTotal)"
    >
      <ItemCard v-for="transaction in visibleTransactions" :key="transaction.id">
        <template #main>
          <div class="tx-row">
            <h3>{{ transaction.description || 'Ausgabe' }}</h3>
            <Tag severity="info" :value="formatMoney(transaction.amount)" class="tx-pill" />
          </div>
          <div class="tx-meta-row">
            <Tag severity="secondary" :value="budgetLabel(transaction)" class="tx-tag" />
          </div>
          <p>{{ formatDate(transaction.date) }}</p>
          <p class="tx-author">Von {{ transaction.user.displayName || transaction.user.email }}</p>
        </template>
        <template #actions>
          <Button label="Bearbeiten" icon="pi pi-pen-to-square" severity="secondary" outlined size="small" @click="editTransaction(transaction)" />
          <Button
            label="Löschen"
            icon="pi pi-trash"
            severity="danger"
            outlined
            size="small"
            :loading="actionLoadingKey === `expense:${transaction.id}`"
            @click="deleteTransaction(transaction)"
          />
        </template>
      </ItemCard>

      <div v-if="visibleTransactions.length === 0" class="empty-list">Noch keine Ausgaben erfasst.</div>
    </ListPanel>

    <FormDialog
      v-model:visible="transactionDialogOpen"
      :header="editingTransactionId ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'"
      :submit-label="editingTransactionId ? 'Ausgabe aktualisieren' : 'Ausgabe anlegen'"
      :saving="transactionLoading"
      @save="saveTransaction"
      @cancel="closeTransactionDialog"
    >
      <FormField label="Betrag" html-for="transaction-amount">
        <InputNumber
          id="transaction-amount"
          v-model="transactionForm.amount"
          mode="currency"
          :currency="currencyCode"
          locale="de-DE"
          inputClass="w-full"
          :minFractionDigits="2"
          :maxFractionDigits="2"
          placeholder="0,00"
        />
      </FormField>
      <FormField label="Datum" html-for="transaction-date">
        <DatePicker id="transaction-date" v-model="transactionForm.date" dateFormat="dd.mm.yy" showIcon inputClass="w-full" />
      </FormField>
      <FormField label="Beschreibung" html-for="transaction-description" wide>
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Einkauf bei Rewe" />
      </FormField>
      <FormField label="Budget" html-for="transaction-budget" wide>
        <Select id="transaction-budget" v-model="transactionForm.budgetId" :options="budgetSelectOptions" optionLabel="label" optionValue="value" />
      </FormField>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.tx-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.tx-pill {
  white-space: nowrap;
}

.tx-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.tx-tag {
  font-size: 0.76rem;
}

.tx-author {
  color: #cbd5e1;
}

.empty-list {
  color: #94a3b8;
  text-align: center;
  padding: 1.25rem 0.75rem;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.5);
}
</style>