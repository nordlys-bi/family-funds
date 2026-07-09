<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: unknown[]
}

type TransactionItem = {
  id: string
  kind: 'expense' | 'income'
  amount: number
  description: string | null
  date: string
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
})

const visibleTransactions = computed(() => transactions.value.filter((transaction) => transaction.kind === 'income'))

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
  transactionForm.value = { amount: null, description: '', date: new Date() }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const editTransaction = (transaction: TransactionItem) => {
  editingTransactionId.value = transaction.id
  transactionForm.value = {
    amount: transaction.amount / 100,
    description: transaction.description ?? '',
    date: new Date(transaction.date),
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
      kind: 'income' as const,
      ...(editingTransactionId.value ? { id: editingTransactionId.value } : {}),
      amount: transactionForm.value.amount ?? undefined,
      description: transactionForm.value.description,
      date: transactionForm.value.date ? formatDateInput(transactionForm.value.date) : undefined,
    }
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: editingTransactionId.value ? 'PATCH' : 'POST',
      body: payload,
    })
    await loadData()
    closeTransactionDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Einnahme wurde aktualisiert.' : 'Einnahme wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahme konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    transactionLoading.value = false
  }
}

const deleteTransaction = async (transaction: TransactionItem) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `income:${transaction.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'DELETE',
      body: { kind: 'income', id: transaction.id },
    })
    await loadData()
    notice.value = { severity: 'success', text: 'Einnahme wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahme konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
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
    title="Einnahmen"
    description="Erfasse alle Einnahmen für den aktuellen Monat — Gehalt, Boni, Rückerstattungen, Geschenke."
  >
    <template #summary>
      <Tag severity="success" :value="`Einnahmen ${formatMoney(summary.incomeTotal)}`" />
      <Tag severity="info" :value="`${visibleTransactions.length} Buchungen`" />
    </template>

    <template #toolbar>
      <Button label="Einnahme anlegen" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Einnahmen werden geladen"
    />

    <template v-if="!loading && activeHousehold && currentHousehold">
      <ListPanel
        kicker="Monat"
        title="Aktuelle Einnahmen"
        compact
        :badge="formatMoney(summary.incomeTotal)"
      >
        <ListTable dense accent="primary">
          <template #head>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th class="muted">Von</th>
            <th class="num">Betrag</th>
            <th class="actions"></th>
          </template>

          <tr v-for="transaction in visibleTransactions" :key="transaction.id">
            <td class="muted">{{ formatDate(transaction.date) }}</td>
            <td class="name">{{ transaction.description || 'Einnahme' }}</td>
            <td class="muted">{{ transaction.user.displayName || transaction.user.email }}</td>
            <td class="num income-amount">+{{ formatMoney(transaction.amount) }}</td>
            <td class="actions">
              <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editTransaction(transaction)" />
              <Button
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                text
                :loading="actionLoadingKey === `income:${transaction.id}`"
                @click="deleteTransaction(transaction)"
              />
            </td>
          </tr>

          <tr v-if="visibleTransactions.length === 0">
            <td colspan="5" class="data-table__empty">Noch keine Einnahmen erfasst.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle. -->
          <template #mobile>
            <div v-if="visibleTransactions.length === 0" class="data-table__empty">
              Noch keine Einnahmen erfasst.
            </div>
            <div
              v-for="transaction in visibleTransactions"
              v-else
              :key="`m-${transaction.id}`"
              class="data-table__card"
            >
              <div class="data-table__card-line">
                <span class="data-table__card-name">
                  {{ transaction.description || 'Einnahme' }}
                </span>
                <span class="data-table__card-amount income-amount">
                  +{{ formatMoney(transaction.amount) }}
                </span>
              </div>
              <div class="data-table__card-meta">
                <span>{{ formatDate(transaction.date) }}</span>
                <span>·</span>
                <span>{{ transaction.user.displayName || transaction.user.email }}</span>
              </div>
              <div class="data-table__card-actions">
                <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text @click="editTransaction(transaction)" />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  text
                  :loading="actionLoadingKey === `income:${transaction.id}`"
                  @click="deleteTransaction(transaction)"
                />
              </div>
            </div>
          </template>
        </ListTable>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="transactionDialogOpen"
      :header="editingTransactionId ? 'Einnahme bearbeiten' : 'Neue Einnahme'"
      :submit-label="editingTransactionId ? 'Einnahme aktualisieren' : 'Einnahme anlegen'"
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
        <InputText id="transaction-description" v-model="transactionForm.description" placeholder="z. B. Gehalt September" />
      </FormFieldRow>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.income-amount {
  color: #34d399;
}
</style>