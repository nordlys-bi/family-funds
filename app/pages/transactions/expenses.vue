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
const isUnassigned = (transaction: TransactionItem) => !transaction.budgetId

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

    <template v-if="!loading && activeHousehold && currentHousehold">
      <ListPanel
        kicker="Monat"
        title="Aktuelle Ausgaben"
        compact
        :badge="formatMoney(summary.expenseTotal)"
      >
        <ListTable dense accent="primary">
          <template #head>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th>Budget</th>
            <th class="muted">Von</th>
            <th class="num">Betrag</th>
            <th class="actions"></th>
          </template>

          <tr v-for="transaction in visibleTransactions" :key="transaction.id">
            <td class="muted">{{ formatDate(transaction.date) }}</td>
            <td class="name">
              {{ transaction.description || 'Ausgabe' }}
              <span v-if="isUnassigned(transaction)" class="sub">ohne Budgetzuordnung</span>
            </td>
            <td>
              <span :class="['budget-pill', isUnassigned(transaction) ? 'budget-pill--muted' : '']">
                {{ budgetLabel(transaction) }}
              </span>
            </td>
            <td class="muted">{{ transaction.user.displayName || transaction.user.email }}</td>
            <td class="num">−{{ formatMoney(transaction.amount) }}</td>
            <td class="actions">
              <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editTransaction(transaction)" />
              <Button
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                text
                :loading="actionLoadingKey === `expense:${transaction.id}`"
                @click="deleteTransaction(transaction)"
              />
            </td>
          </tr>

          <tr v-if="visibleTransactions.length === 0">
            <td colspan="6" class="data-table__empty">Noch keine Ausgaben erfasst.</td>
          </tr>
        </ListTable>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="transactionDialogOpen"
      :header="editingTransactionId ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'"
      :submit-label="editingTransactionId ? 'Ausgabe aktualisieren' : 'Ausgabe anlegen'"
      :saving="transactionLoading"
      @save="saveTransaction"
      @cancel="closeTransactionDialog"
    >
      <FormFieldRow label="Betrag" html-for="transaction-amount">
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
      </FormFieldRow>
      <FormFieldRow label="Datum" html-for="transaction-date">
        <DatePicker id="transaction-date" v-model="transactionForm.date" dateFormat="dd.mm.yy" showIcon inputClass="w-full" />
      </FormFieldRow>
      <FormFieldRow label="Beschreibung" html-for="transaction-description" wide>
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Einkauf bei Rewe" />
      </FormFieldRow>
      <FormFieldRow label="Budget" html-for="transaction-budget" wide>
        <Select id="transaction-budget" v-model="transactionForm.budgetId" :options="budgetSelectOptions" optionLabel="label" optionValue="value" />
      </FormFieldRow>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.budget-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: #93c5fd;
  font-size: 0.74rem;
  font-weight: 700;
  white-space: nowrap;
}

.budget-pill--muted {
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}
</style>