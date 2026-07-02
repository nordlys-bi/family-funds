/**
 * Dashboard-Aggregation-Logik.
 *
 * Reine Funktionen ohne HTTP/Auth/DB-Abhängigkeit. Werden vom
 * `GET /api/households/:id/dashboard`-Handler aufgerufen und in
 * `dashboard.integration.test.ts` getestet.
 *
 * Verwendet `BudgetOverview` aus `budget-evaluation.ts`, um die
 * Budget-Aggregation nicht zu duplizieren (Issue-Anforderung:
 * "buildBudgetOverview wiederverwenden, nicht neu schreiben").
 */
import type { BudgetOverview } from './budget-evaluation'

// ---------------------------------------------------------------------------
// Types — die Response-Shape, die der Dashboard-Endpoint liefert.
// ---------------------------------------------------------------------------

export type DashboardBudgetAlert = {
  budgetId: string
  key: string
  name: string
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: 'ok' | 'warning' | 'over'
}

export type DashboardRecentActivity = {
  id: string
  kind: 'expense' | 'income'
  amount: number
  description: string | null
  date: Date
  budgetId: string | null
  budgetName: string | null
  budgetKey: string | null
  userDisplayName: string | null
}

export type DashboardSavingsGoal = {
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  monthlyRate: number
  percentToTarget: number
}

export type DashboardMonthSummary = {
  income: number
  expenses: number
  balance: number
  unassignedExpenses: number
}

export type DashboardData = {
  householdId: string
  monthStart: Date
  monthEnd: Date
  monthSummary: DashboardMonthSummary
  budgetAlerts: DashboardBudgetAlert[]
  recentActivity: DashboardRecentActivity[]
  savingsGoals: DashboardSavingsGoal[]
}

// ---------------------------------------------------------------------------
// Severity — issue-spec: exakt 80% = warning, exakt 100% = warning,
// >100% = over, sonst ok. "Sonstiges"-Bucket wird im Handler aussortiert,
// bevor die Severity berechnet wird.
// ---------------------------------------------------------------------------

export type DashboardSeverity = DashboardBudgetAlert['severity']

const SEVERITY_ORDER: Record<DashboardSeverity, number> = {
  over: 0,
  warning: 1,
  ok: 2,
}

export function classifySeverity(percentUsed: number): DashboardSeverity {
  if (percentUsed > 100) return 'over'
  if (percentUsed >= 80) return 'warning'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Budget-Alerts — alle Budgets aus BudgetOverview mit Severity-Klassifikation,
// sortiert nach (severity-priority asc, percentUsed desc). Liefert KEIN
// "Sonstiges" zurück, weil das nur ein virtueller Bucket ist.
// ---------------------------------------------------------------------------

export function buildBudgetAlerts(budgetOverview: BudgetOverview): DashboardBudgetAlert[] {
  return budgetOverview.budgets
    .map((budget) => {
      const percentUsed = budget.plannedAmount > 0
        ? (budget.spentAmount / budget.plannedAmount) * 100
        : 0

      return {
        budgetId: budget.budgetId,
        key: budget.key,
        name: budget.name,
        plannedAmount: budget.plannedAmount,
        spentAmount: budget.spentAmount,
        remainingAmount: budget.remainingAmount,
        percentUsed,
        severity: classifySeverity(percentUsed),
      }
    })
    .sort((left, right) => {
      const severityDiff = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      if (severityDiff !== 0) return severityDiff
      return right.percentUsed - left.percentUsed
    })
}

// ---------------------------------------------------------------------------
// Recent Activity — die letzten 5 Transaktionen (Expense + Income gemischt)
// aus den letzten 7 Tagen. Neueste zuerst.
// ---------------------------------------------------------------------------

type RecentExpense = {
  id: string
  amount: number
  description: string | null
  date: Date
  budgetId: string | null
  budget: { name: string; key: string } | null
  user: { displayName: string | null }
}

type RecentIncome = {
  id: string
  amount: number
  description: string | null
  date: Date
  user: { displayName: string | null }
}

export function buildRecentActivity(
  expenses: RecentExpense[],
  incomes: RecentIncome[],
  now: Date = new Date(),
): DashboardRecentActivity[] {
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  const merged: DashboardRecentActivity[] = [
    ...expenses.map((expense) => ({
      id: expense.id,
      kind: 'expense' as const,
      amount: expense.amount,
      description: expense.description,
      date: expense.date,
      budgetId: expense.budgetId,
      budgetName: expense.budget?.name ?? null,
      budgetKey: expense.budget?.key ?? null,
      userDisplayName: expense.user.displayName,
    })),
    ...incomes.map((income) => ({
      id: income.id,
      kind: 'income' as const,
      amount: income.amount,
      description: income.description,
      date: income.date,
      budgetId: null,
      budgetName: null,
      budgetKey: null,
      userDisplayName: income.user.displayName,
    })),
  ]

  return merged
    .filter((entry) => entry.date >= sevenDaysAgo && entry.date <= now)
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, 5)
}

// ---------------------------------------------------------------------------
// Savings-Goal-Progress — pro aktivem Sparziel: aktueller Stand (Summe der
// `SavingsGoalExecution.amount`), Zielbetrag, monatliche Rate, Prozent.
// Sortiert nach `percentToTarget` desc.
// ---------------------------------------------------------------------------

type SavingsGoalWithExecutions = {
  id: string
  name: string
  targetAmount: number
  monthlyRate: number
  executions: { amount: number }[]
}

export function buildSavingsGoalsProgress(
  goals: SavingsGoalWithExecutions[],
): DashboardSavingsGoal[] {
  return goals
    .map((goal) => {
      const currentAmount = goal.executions.reduce((sum, execution) => sum + execution.amount, 0)
      const percentToTarget = goal.targetAmount > 0
        ? (currentAmount / goal.targetAmount) * 100
        : 0

      return {
        id: goal.id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        currentAmount,
        monthlyRate: goal.monthlyRate,
        percentToTarget,
      }
    })
    .sort((left, right) => right.percentToTarget - left.percentToTarget)
}