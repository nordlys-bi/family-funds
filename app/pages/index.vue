<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

const { user } = useAppAuth()

type DashboardData = {
  householdId: string
  monthSummary: {
    income: number
    expenses: number
    balance: number
    unassignedExpenses: number
  }
  budgetAlerts: Array<{
    budgetId: string
    name: string
    plannedAmount: number
    spentAmount: number
    remainingAmount: number
    percentUsed: number
    severity: 'ok' | 'warning' | 'over'
  }>
  recentActivity: Array<{
    id: string
    kind: 'expense' | 'income'
    amount: number
    description: string | null
    date: string
    budgetName: string | null
    userDisplayName: string | null
  }>
  savingsGoals: Array<{
    id: string
    name: string
    targetAmount: number
    currentAmount: number
    monthlyRate: number
    percentToTarget: number
  }>
}

const { activeHousehold } = useHousehold()
const snapshot = ref<DashboardData | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')

const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)
const formatMoney = (cents: number | null | undefined) =>
  moneyFormatter.value.format((cents ?? 0) / 100)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()),
)

const summary = computed(() => snapshot.value?.monthSummary ?? null)
const savingsGoals = computed(() => snapshot.value?.savingsGoals ?? [])
const budgetAlerts = computed(() => snapshot.value?.budgetAlerts ?? [])
const recentActivity = computed(() => snapshot.value?.recentActivity ?? [])

const savingsCurrentTotal = computed(() =>
  savingsGoals.value.reduce((sum, g) => sum + (g.currentAmount ?? 0), 0),
)
const savingsTargetTotal = computed(() =>
  savingsGoals.value.reduce((sum, g) => sum + (g.targetAmount ?? 0), 0),
)
const savingsPct = computed(() => {
  if (savingsTargetTotal.value === 0) return 0
  return Math.min(100, (savingsCurrentTotal.value / savingsTargetTotal.value) * 100)
})

const balanceTone = computed(() => ((summary.value?.balance ?? 0) >= 0 ? 'primary' : 'danger'))

async function loadDashboard() {
  if (!activeHousehold.value) {
    snapshot.value = null
    errorMessage.value = null
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    const data = await $fetch<DashboardData>(
      `/api/households/${activeHousehold.value.id}/dashboard`,
      { headers },
    )
    snapshot.value = data
  } catch (err: any) {
    errorMessage.value =
      err.statusMessage || err.message || 'Dashboard konnte nicht geladen werden.'
    snapshot.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDashboard)
watch(() => activeHousehold.value?.id, loadDashboard)
</script>

<template>
  <ListPageShell
    eyebrow="Dashboard"
    :title="`Hallo, ${user?.displayName || 'Gast'} \u{1F44B}`"
    :description="`Dein finanzieller Überblick für ${monthLabel}.`"
  >
    <EmptyState
      v-if="!activeHousehold"
      :no-household="true"
      no-household-title="Wähle einen Haushalt aus dem Menü"
      no-household-text="Damit wir dein Dashboard mit echten Daten füllen können."
    />

    <EmptyState
      v-else-if="loading && !snapshot"
      :loading="true"
      loading-title="Dashboard wird geladen"
      loading-text="Wir holen die aktuellen Zahlen aus der Datenbank."
    />

    <Message v-else-if="errorMessage" severity="error" :closable="false" class="mb-6">
      Dashboard konnte nicht geladen werden: {{ errorMessage }}
    </Message>

    <template v-else-if="snapshot">
      <div class="dashboard-kpis">
        <KpiCard
          tone="success"
          icon="pi pi-arrow-up-right"
          label="Einnahmen"
          :value="formatMoney(summary?.income)"
          :meta="monthLabel"
        />
        <KpiCard
          tone="danger"
          icon="pi pi-arrow-down-right"
          label="Ausgaben"
          :value="formatMoney(summary?.expenses)"
          :meta="
            summary && summary.expenses > 0
              ? `${budgetAlerts.length} aktive Budgets`
              : 'Noch keine Buchungen'
          "
        />
        <KpiCard
          :tone="balanceTone"
          icon="pi pi-wallet"
          label="Saldo"
          :value="formatMoney(summary?.balance)"
          meta="Einnahmen − Ausgaben"
        />
        <KpiCard
          tone="warning"
          icon="pi pi-star"
          label="Sparziele"
          :value="formatMoney(savingsCurrentTotal)"
          :meta="`${savingsPct.toFixed(0)}% von ${formatMoney(savingsTargetTotal)}`"
        />
      </div>

      <ListPanel kicker="Budget" title="Budget-Auslastung" :compact="true">
        <template #actions>
          <NuxtLink to="/budgeting/budgets">
            <Button label="Budget anlegen" icon="pi pi-plus" size="small" severity="secondary" outlined />
          </NuxtLink>
        </template>
        <DashboardBudgetList :alerts="budgetAlerts" :format-money="formatMoney" />
      </ListPanel>

      <ListPanel kicker="Aktivität" title="Letzte Buchungen" :compact="true">
        <template #actions>
          <NuxtLink to="/transactions/expenses">
            <Button label="Ausgabe erfassen" icon="pi pi-plus" size="small" severity="primary" />
          </NuxtLink>
        </template>
        <DashboardActivityList :activity="recentActivity" :format-money="formatMoney" />
      </ListPanel>
    </template>
  </ListPageShell>
</template>

<style scoped>
.dashboard-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}
</style>
