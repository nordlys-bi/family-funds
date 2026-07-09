<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type PlanningHousehold = {
  id: string
  name: string
  currency: string
  budgets: unknown[]
}

const { activeHousehold, fetchHouseholds } = useHousehold()
const route = useRoute()
const router = useRouter()

const currentHousehold = ref<PlanningHousehold | null>(null)
const notice = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)
const editingTransactionId = ref<string | null>(null)
const transactionDialogOpen = ref(false)
const transactionLoading = ref(false)
const actionLoadingKey = ref<string | null>(null)

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

// --- Month-Filter via Composable (issue #9) ---
// Initial aus URL-Query ?month=YYYY-MM, sonst aktueller Monat.
const txList = useTransactionList({
  initialMonth: typeof route.query.month === 'string' ? route.query.month : undefined,
})

const visibleTransactions = computed(() => txList.transactionsByKind('income'))

const transactionForm = ref({
  amount: null as number | null,
  description: '',
  date: new Date(),
})

// Month-Spinner-Change → URL-Sync + Reload (kein Full-Page-Reload)
async function onMonthChange(newMonth: string) {
  await txList.setMonth(newMonth, activeHouseholdId.value)
  // query.month == aktueller Monat → Query loeschen, damit die Default-URL
  // sauber bleibt (kein "?month=2026-07" im Juli, wenn Juli der Default ist).
  const currentMonth = new Date().toISOString().slice(0, 7)
  const query = newMonth === currentMonth ? {} : { month: newMonth }
  await router.replace({ query })
}

// --- Daten laden ---
async function loadCurrentHousehold() {
  try {
    const current = await $fetch<{ household: PlanningHousehold | null }>('/api/households/current')
    currentHousehold.value = current.household
  } catch (error) {
    currentHousehold.value = null
  }
}

async function loadAll() {
  await Promise.all([
    loadCurrentHousehold(),
    txList.load(activeHouseholdId.value),
  ])
}

const resetForm = () => {
  transactionForm.value = { amount: null, description: '', date: new Date() }
  editingTransactionId.value = null
}

const openCreateTransactionDialog = () => { resetForm(); transactionDialogOpen.value = true }

const editTransaction = (transaction: { id: string; amount: number; description: string | null; date: string }) => {
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
    await loadAll()
    closeTransactionDialog()
    notice.value = { severity: 'success', text: isEdit ? 'Einnahme wurde aktualisiert.' : 'Einnahme wurde angelegt.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahme konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    transactionLoading.value = false
  }
}

const deleteTransaction = async (transaction: { id: string }) => {
  if (!activeHouseholdId.value) return
  actionLoadingKey.value = `income:${transaction.id}`
  notice.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/transactions`, {
      method: 'DELETE',
      body: { kind: 'income', id: transaction.id },
    })
    await loadAll()
    notice.value = { severity: 'success', text: 'Einnahme wurde gelöscht.' }
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Einnahme konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    actionLoadingKey.value = null
  }
}

// Composable-Fehler in Notice mappen, damit User was sehen.
watch(() => txList.error.value, (error) => {
  if (error) {
    notice.value = { severity: 'error', text: 'Transaktionen konnten nicht geladen werden: ' + error }
  }
})

onMounted(async () => {
  await fetchHouseholds()
  await loadAll()
})
watch(activeHouseholdId, async () => { await loadAll() })
</script>

<template>
  <ListPageShell
    title="Einnahmen"
    :description="`Erfasse alle Einnahmen fuer ${txList.monthLabel} — Gehalt, Boni, Rueckerstattungen, Geschenke.`"
  >
    <template #summary>
      <Tag severity="success" :value="`Einnahmen ${formatMoney(txList.summary.incomeTotal)}`" />
      <Tag severity="info" :value="`${visibleTransactions.length} Buchungen`" />
    </template>

    <template #toolbar>
      <div class="toolbar-month">
        <label for="income-month-select" class="toolbar-month__label">Monat</label>
        <Select
          id="income-month-select"
          :model-value="txList.month"
          :options="txList.monthOptions"
          option-label="label"
          option-value="value"
          :loading="txList.loading"
          aria-label="Monat auswaehlen"
          @update:model-value="onMonthChange"
        />
      </div>
      <Button label="Einnahme anlegen" icon="pi pi-plus" severity="success" @click="openCreateTransactionDialog" />
    </template>

    <Message v-if="notice" :severity="notice.severity" variant="simple">{{ notice.text }}</Message>

    <EmptyState
      :loading="txList.loading"
      :no-household="!txList.loading && !activeHousehold"
      loading-title="Einnahmen werden geladen"
    />

    <template v-if="!txList.loading && activeHousehold && currentHousehold">
      <ListPanel
        kicker="Monat"
        :title="`Einnahmen ${txList.monthLabel}`"
        compact
        :badge="formatMoney(txList.summary.incomeTotal)"
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
              <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Einnahme bearbeiten" @click="editTransaction(transaction)" />
              <Button
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                text
                aria-label="Einnahme löschen"
                :loading="actionLoadingKey === `income:${transaction.id}`"
                @click="deleteTransaction(transaction)"
              />
            </td>
          </tr>

          <tr v-if="visibleTransactions.length === 0">
            <td colspan="5" class="data-table__empty">Keine Einnahmen in {{ txList.monthLabel }}.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle. -->
          <template #mobile>
            <div v-if="visibleTransactions.length === 0" class="data-table__empty">
              Keine Einnahmen in {{ txList.monthLabel }}.
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
                <Button icon="pi pi-pen-to-square" severity="secondary" outlined size="small" text aria-label="Einnahme bearbeiten" @click="editTransaction(transaction)" />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  text
                  aria-label="Einnahme löschen"
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

.toolbar-month {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
}

.toolbar-month__label {
  font-size: 0.85rem;
  color: var(--text-muted, #94a3b8);
}

@media (max-width: 480px) {
  .toolbar-month {
    width: 100%;
  }
}
</style>
