/**
 * Wire-Typen fuer Budget-Liste und -Detailseite (ADR-0004).
 *
 * Datumswerte kommen als ISO-Strings (JSON-Serialisierung von `Date`),
 * Tage im Saldo-Verlauf als `YYYY-MM-DD`. Alle Betraege in Cent.
 */
import type { Frequency } from './planning'

export type BudgetVersionItem = {
  id: string
  amount: number
  validFrom: string
}

export type BudgetCurrentPeriod = {
  start: string
  /** null = offene Periode (ONCE ohne Nachfolge-Version). */
  end: string | null
  plannedAmount: number
  spentAmount: number
  remainingAmount: number
  percentUsed: number
  severity: 'ok' | 'warning' | 'over'
  forecast: {
    forecastTotal: number
    forecastRemaining: number
    severity: 'on-track' | 'warning' | 'over'
    basisDays: number
  } | null
}

/** Ein Eintrag aus `GET /api/households/:id/budgets`. */
export type BudgetListItem = {
  id: string
  key: string
  name: string
  frequency: Frequency
  balanceSince: string
  closedAt: string | null
  carryoverToBudgetId: string | null
  /** Neueste Version zuerst. */
  versions: BudgetVersionItem[]
  balance: { balance: number } | null
  /** Ausgaben, Umbuchungen oder Vorgaenger vorhanden — dann nur Schliessen, kein Loeschen. */
  hasBookings: boolean
  /** Saldo im Wochenraster der letzten 3 Monate (Sparkline). */
  balanceTrend: number[]
  currentPeriod: BudgetCurrentPeriod | null
}

export type BalanceHistoryEntry = {
  type: 'allocation' | 'expense' | 'transfer' | 'carryover'
  date: string
  /** Wirkung auf den Saldo: + erhoeht, − senkt. */
  amount: number
  budgetId: string
  budgetName: string | null
  id?: string
  text?: string | null
  savingsGoal?: { id: string; name: string } | null
  fromBudgetId?: string
  fromBudgetName?: string | null
}

export type BalanceHistoryEvent = {
  type: 'transfer' | 'version' | 'carryover'
  date: string
  amount: number
  budgetId: string
  budgetName: string | null
  fromBudgetId?: string
  fromBudgetName?: string | null
}

/** `GET /api/households/:id/budgets/:budgetId/balance-history`. */
export type BalanceHistoryResponse = {
  budgetId: string
  from: string
  to: string
  points: Array<{ date: string; balance: number }>
  events: BalanceHistoryEvent[]
  entries: BalanceHistoryEntry[]
  chain: Array<{ id: string; name: string }>
}
