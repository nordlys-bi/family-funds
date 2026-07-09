<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

// Shape aus `server/api/households/[householdId]/dashboard.get.ts`.
// Lokal dupliziert weil wir keinen zentralen Typen-Export haben —
// bei nächster Gelegenheit als gemeinsamen Type in `server/types/` heben.
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

const { user } = useAppAuth()
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

// Top-3 Alerts, die wirklich Aufmerksamkeit brauchen (warning/over zuerst).
const criticalAlerts = computed(() =>
  [...budgetAlerts.value]
    .sort((a, b) => {
      const order = { over: 0, warning: 1, ok: 2 } as const
      return order[a.severity] - order[b.severity] || b.percentUsed - a.percentUsed
    })
    .slice(0, 3)
    .filter((alert) => alert.severity !== 'ok'),
)

async function loadDashboard() {
  if (!activeHousehold.value) {
    snapshot.value = null
    errorMessage.value = null
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    // SSR-sicher: Cookies im Server-Render explizit weiterreichen (analog zu
    // useHousehold.ts), sonst sieht die API beim SSR keine Session.
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
  <div class="dashboard-page">
    <!-- Welcome -->
    <div class="welcome-header mb-6">
      <h1 class="welcome-title">Hallo, {{ user?.displayName || 'Gast' }}! 👋</h1>
      <p class="welcome-subtitle">Dein finanzieller Überblick für {{ monthLabel }}.</p>
    </div>

    <!-- Active Household Context Banner -->
    <div v-if="activeHousehold" class="context-banner mb-6">
      <div class="banner-row">
        <div class="banner-identity">
          <div class="icon-badge">
            <i class="pi pi-home"></i>
          </div>
          <div>
            <h3 class="banner-name">{{ activeHousehold.name }}</h3>
            <p class="banner-meta">
              Währung: <strong>{{ activeHousehold.currency }}</strong>
              &nbsp;·&nbsp; Deine Rolle:
              <RoleTag :role="activeHousehold.role" />
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty: kein Haushalt aktiv -->
    <Message v-if="!activeHousehold" severity="info" :closable="false" class="mb-6">
      Wähle einen Haushalt aus dem Menü, um dein Dashboard zu sehen.
    </Message>

    <!-- Loading -->
    <div v-else-if="loading && !snapshot" class="stats-grid mb-8">
      <div v-for="i in 4" :key="i" class="stat-card stat-card--loading">
        <div class="shimmer shimmer-line shimmer-line--lg" />
        <div class="shimmer shimmer-line shimmer-line--sm" />
      </div>
    </div>

    <!-- Error -->
    <Message v-else-if="errorMessage" severity="error" :closable="false" class="mb-6">
      Dashboard konnte nicht geladen werden: {{ errorMessage }}
    </Message>

    <!-- Stats + Budget Alerts + Recent Activity -->
    <template v-else-if="snapshot">
      <!-- 4 KPI Cards: diesmal ehrlich, jede mit echten Daten -->
      <div class="stats-grid mb-6">
        <Card class="stat-card">
          <template #content>
            <div class="stat-row">
              <div>
                <span class="stat-label">Einnahmen</span>
                <div class="stat-value text-green-500">
                  {{ formatMoney(summary?.income) }}
                </div>
                <span class="stat-meta">{{ monthLabel }}</span>
              </div>
              <div class="stat-icon-wrap stat-icon-wrap--green">
                <i class="pi pi-arrow-up-right"></i>
              </div>
            </div>
          </template>
        </Card>

        <Card class="stat-card">
          <template #content>
            <div class="stat-row">
              <div>
                <span class="stat-label">Ausgaben</span>
                <div class="stat-value text-red-400">
                  {{ formatMoney(summary?.expenses) }}
                </div>
                <span class="stat-meta">
                  {{ summary && summary.expenses > 0
                    ? `${budgetAlerts.length} aktive Budgets`
                    : 'Noch keine Buchungen' }}
                </span>
              </div>
              <div class="stat-icon-wrap stat-icon-wrap--red">
                <i class="pi pi-arrow-down-right"></i>
              </div>
            </div>
          </template>
        </Card>

        <Card class="stat-card">
          <template #content>
            <div class="stat-row">
              <div>
                <span class="stat-label">Saldo</span>
                <div
                  class="stat-value"
                  :class="(summary?.balance ?? 0) >= 0 ? 'text-blue-400' : 'text-red-400'"
                >
                  {{ formatMoney(summary?.balance) }}
                </div>
                <span class="stat-meta">Einnahmen − Ausgaben</span>
              </div>
              <div class="stat-icon-wrap stat-icon-wrap--blue">
                <i class="pi pi-wallet"></i>
              </div>
            </div>
          </template>
        </Card>

        <Card class="stat-card">
          <template #content>
            <div class="stat-row">
              <div>
                <span class="stat-label">Sparziele</span>
                <div class="stat-value text-purple-400">
                  {{ formatMoney(savingsCurrentTotal) }}
                </div>
                <span class="stat-meta">
                  {{ savingsPct.toFixed(0) }}% von {{ formatMoney(savingsTargetTotal) }}
                </span>
              </div>
              <div class="stat-icon-wrap stat-icon-wrap--purple">
                <i class="pi pi-star"></i>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <!-- Budget-Auslastung + Letzte Aktivität: zwei Spalten ab md, gestapelt darunter -->
      <div class="dashboard-secondary">
        <Card class="panel-card">
          <template #title>
            <div class="panel-title">
              <i class="pi pi-chart-pie text-primary"></i>
              <span>Budget-Auslastung</span>
            </div>
          </template>
          <template #content>
            <div v-if="budgetAlerts.length === 0" class="panel-empty">
              Noch keine Budgets angelegt.
              <NuxtLink to="/budgeting/budgets">Budget anlegen</NuxtLink>
            </div>
            <ul v-else class="budget-list">
              <li v-for="alert in budgetAlerts" :key="alert.budgetId" class="budget-item">
                <div class="budget-item-head">
                  <span class="budget-name">{{ alert.name }}</span>
                  <span
                    class="budget-pct"
                    :class="{
                      'text-red-400': alert.severity === 'over',
                      'text-amber-400': alert.severity === 'warning',
                      'text-slate-300': alert.severity === 'ok',
                    }"
                  >
                    {{ alert.percentUsed.toFixed(0) }}%
                  </span>
                </div>
                <div class="budget-track">
                  <div
                    class="budget-fill"
                    :class="{
                      'budget-fill--over': alert.severity === 'over',
                      'budget-fill--warning': alert.severity === 'warning',
                    }"
                    :style="{ width: Math.min(100, alert.percentUsed) + '%' }"
                  />
                </div>
                <div class="budget-meta">
                  {{ formatMoney(alert.spentAmount) }} von {{ formatMoney(alert.plannedAmount) }}
                  &nbsp;·&nbsp; noch {{ formatMoney(alert.remainingAmount) }}
                </div>
              </li>
            </ul>
          </template>
        </Card>

        <Card class="panel-card">
          <template #title>
            <div class="panel-title">
              <i class="pi pi-clock text-primary"></i>
              <span>Letzte Buchungen</span>
            </div>
          </template>
          <template #content>
            <div v-if="recentActivity.length === 0" class="panel-empty">
              Noch keine Buchungen in den letzten 7 Tagen.
              <NuxtLink to="/transactions/expenses">Ausgabe erfassen</NuxtLink>
            </div>
            <ul v-else class="activity-list">
              <li v-for="entry in recentActivity.slice(0, 5)" :key="entry.id" class="activity-item">
                <div class="activity-icon" :class="entry.kind === 'income' ? 'activity-icon--green' : 'activity-icon--red'">
                  <i :class="entry.kind === 'income' ? 'pi pi-arrow-down-left' : 'pi pi-arrow-up-right'"></i>
                </div>
                <div class="activity-body">
                  <div class="activity-line">
                    <span class="activity-desc">{{ entry.description || (entry.kind === 'income' ? 'Einnahme' : 'Ausgabe') }}</span>
                    <span
                      class="activity-amount"
                      :class="entry.kind === 'income' ? 'text-green-500' : 'text-red-400'"
                    >
                      {{ entry.kind === 'income' ? '+' : '−' }}{{ formatMoney(entry.amount) }}
                    </span>
                  </div>
                  <div class="activity-meta">
                    {{ entry.userDisplayName || '—' }}
                    <template v-if="entry.budgetName">
                      &nbsp;·&nbsp; {{ entry.budgetName }}
                    </template>
                    &nbsp;·&nbsp; {{ new Date(entry.date).toLocaleDateString('de-DE') }}
                  </div>
                </div>
              </li>
            </ul>
          </template>
        </Card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard-page { animation: fadeIn 0.5s ease-out; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0 0 0.5rem 0;
  background: linear-gradient(to right, #f8fafc, #cbd5e1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.welcome-subtitle {
  color: #94a3b8;
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
}

.context-banner {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  backdrop-filter: blur(12px);
}

.banner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.banner-identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.icon-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border-radius: 12px;
  font-size: 1.25rem;
  flex-shrink: 0;
}

.banner-name {
  font-weight: 700;
  font-size: 1.1rem;
  margin: 0;
  color: #f1f5f9;
}

.banner-meta {
  font-size: 0.85rem;
  color: #94a3b8;
  margin: 0.15rem 0 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
}

.stat-card {
  background: rgba(30, 41, 59, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 16px !important;
  transition: transform 0.2s, border-color 0.2s;
}
.stat-card:hover { transform: translateY(-2px); border-color: rgba(255, 255, 255, 0.12) !important; }

.stat-card--loading {
  background: rgba(30, 41, 59, 0.2) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 16px !important;
  padding: 1.25rem 1.5rem;
  height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.6rem;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.stat-label {
  font-size: 0.85rem;
  color: #94a3b8;
  display: block;
  margin-bottom: 0.35rem;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
}

.stat-meta {
  font-size: 0.75rem;
  color: #64748b;
  display: block;
  margin-top: 0.25rem;
}

.stat-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  flex-shrink: 0;
}
.stat-icon-wrap--green  { background: rgba(34, 197, 94, 0.10); color: rgb(34, 197, 94); }
.stat-icon-wrap--red    { background: rgba(248, 113, 113, 0.10); color: rgb(248, 113, 113); }
.stat-icon-wrap--blue   { background: rgba(59, 130, 246, 0.10); color: rgb(59, 130, 246); }
.stat-icon-wrap--purple { background: rgba(168, 85, 247, 0.10); color: rgb(168, 85, 247); }

.shimmer {
  background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.10), rgba(255,255,255,0.04));
  background-size: 200% 100%;
  animation: shimmerMove 1.4s ease-in-out infinite;
  border-radius: 6px;
}
.shimmer-line { height: 12px; }
.shimmer-line--lg { height: 28px; width: 60%; }
.shimmer-line--sm { width: 40%; opacity: 0.6; }
@keyframes shimmerMove {
  0% { background-position: 0% 0; }
  100% { background-position: -200% 0; }
}

/* Secondary panels: 2 cols ab md, gestapelt auf Mobile */
.dashboard-secondary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 900px) {
  .dashboard-secondary { grid-template-columns: 1fr 1fr; }
}

.panel-card {
  background: rgba(30, 41, 59, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 16px !important;
  color: #e2e8f0 !important;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.panel-empty {
  color: #94a3b8;
  font-size: 0.9rem;
  padding: 0.5rem 0;
}
.panel-empty a {
  color: rgb(96, 165, 250);
  text-decoration: none;
  margin-left: 0.5rem;
}
.panel-empty a:hover { text-decoration: underline; }

/* Budget-List */
.budget-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 1.1rem; }
.budget-item-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.35rem; }
.budget-name { font-weight: 600; color: #e2e8f0; font-size: 0.95rem; }
.budget-pct { font-weight: 600; font-size: 0.85rem; }
.budget-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  overflow: hidden;
}
.budget-fill {
  height: 100%;
  background: rgb(96, 165, 250);
  border-radius: 999px;
  transition: width 0.4s ease;
}
.budget-fill--warning { background: rgb(251, 191, 36); }
.budget-fill--over { background: rgb(248, 113, 113); }
.budget-meta { font-size: 0.78rem; color: #94a3b8; margin-top: 0.35rem; }

/* Activity-List */
.activity-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.85rem; }
.activity-item { display: flex; gap: 0.75rem; align-items: flex-start; }
.activity-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.95rem;
}
.activity-icon--green { background: rgba(34, 197, 94, 0.10); color: rgb(34, 197, 94); }
.activity-icon--red   { background: rgba(248, 113, 113, 0.10); color: rgb(248, 113, 113); }
.activity-body { flex-grow: 1; min-width: 0; }
.activity-line { display: flex; justify-content: space-between; gap: 0.5rem; }
.activity-desc { font-weight: 500; color: #e2e8f0; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity-amount { font-weight: 600; font-size: 0.92rem; white-space: nowrap; }
.activity-meta { font-size: 0.75rem; color: #94a3b8; margin-top: 0.15rem; }

.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
</style>