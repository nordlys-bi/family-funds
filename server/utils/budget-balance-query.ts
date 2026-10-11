/**
 * DB-Anbindung fuer `computeBudgetBalances` (ADR-0004). Getrennt von
 * `budget-balance.ts`, damit die Saldo-Formel ohne Prisma-Mock testbar
 * bleibt.
 */
import { prisma } from './prisma'
import {
  computeBudgetBalances,
  getEarliestBalanceSince,
  type BalanceBudget,
  type BalanceExpense,
  type BalanceTransfer,
  type BudgetBalance,
} from './budget-balance'

/** Prisma-Select fuer alle Felder, die die Saldo-Berechnung braucht. */
export const budgetBalanceSelect = {
  frequency: true,
  balanceSince: true,
  closedAt: true,
  carryoverToBudgetId: true,
} as const

/**
 * Laedt alle Ausgaben und Umbuchungen ab dem fruehesten `balanceSince` —
 * die Rohdaten fuer `computeBudgetBalances` und den Saldo-Verlauf
 * (`budget-balance-history.ts`).
 */
export async function loadBudgetBalanceInputs(
  householdId: string,
  budgets: BalanceBudget[],
): Promise<{ expenses: BalanceExpense[]; transfers: BalanceTransfer[] }> {
  const earliest = getEarliestBalanceSince(budgets)
  if (!earliest) return { expenses: [], transfers: [] }

  // Ab Mitternacht, damit auch Buchungen mit Uhrzeit vor 12:00 am Starttag
  // mitkommen; das genaue Fenster pro Budget filtert `computeBudgetBalances`.
  const from = new Date(earliest)
  from.setHours(0, 0, 0, 0)

  const [expenses, transfers] = await Promise.all([
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        // Nur die uebergebenen Budgets — beim Verlauf ist das nur die
        // Vorgaenger-Kette, sonst alle Budgets des Haushalts.
        budgetId: { in: budgets.map((budget) => budget.id) },
        date: { gte: from },
        deletedAt: null,
      },
      select: { budgetId: true, amount: true, date: true },
    }),
    prisma.savingsGoalExecution.findMany({
      where: {
        sourceBudgetId: { in: budgets.map((budget) => budget.id) },
        date: { gte: from },
      },
      select: { sourceBudgetId: true, amount: true, date: true },
    }),
  ])

  return { expenses, transfers }
}

/**
 * Laedt Ausgaben und Umbuchungen und berechnet die Salden. `budgets` muss
 * alle Budgets des Haushalts enthalten (auch geschlossene), damit
 * Vorgaenger-Endsalden aufgeloest werden.
 */
export async function loadBudgetBalances(
  householdId: string,
  budgets: BalanceBudget[],
  at: Date = new Date(),
): Promise<Map<string, BudgetBalance>> {
  if (budgets.length === 0) return new Map()
  const { expenses, transfers } = await loadBudgetBalanceInputs(householdId, budgets)
  return computeBudgetBalances(budgets, expenses, transfers, at)
}
