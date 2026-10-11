/*
 * GET /api/households/:householdId/budgets/:id/balance-history?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * ADR-0004: Saldo-Verlauf eines Budgets als Stufen-Zeitreihe plus markierte
 * Ereignisse (Umbuchung, Versionswechsel, Uebertrag). Berechnet pro Request
 * aus denselben Rohdaten wie der Saldo selbst, nichts wird persistiert.
 * Default-Zeitraum: drei Monate bis heute. Auth: MEMBERSHIP.
 *
 * Fuer ein Nachfolge-Budget enthaelt die Linie auch den Verlauf der
 * geschlossenen Vorgaenger (Kettensaldo, siehe budget-balance-history.ts).
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { budgetBalanceSelect, loadBudgetBalanceInputs } from '../../../../../utils/budget-balance-query'
import {
  computeBudgetBalanceHistory,
  getBudgetChain,
  getDefaultHistoryRange,
  getRangeDays,
  MAX_HISTORY_RANGE_DAYS,
} from '../../../../../utils/budget-balance-history'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseOptionalDay(value: unknown, fieldName: string): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${fieldName} must be YYYY-MM-DD.` })
  }
  return parseDateInput(value, fieldName)
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const budgetId = parseUuidParam(event, 'id')

  await requireHouseholdMembership(event, householdId)

  const query = getQuery(event)
  const defaults = getDefaultHistoryRange()
  const requestedTo = parseOptionalDay(query.to, 'to')
  // Kein Blick in die Zukunft: kuenftige Zuteilungen sind noch nicht
  // gutgeschrieben, ein Verlauf darueber hinaus waere eine Prognose.
  const to = requestedTo && requestedTo < defaults.to ? requestedTo : defaults.to
  const from = parseOptionalDay(query.from, 'from') ?? (() => {
    const value = new Date(to)
    value.setMonth(value.getMonth() - 3)
    return value
  })()

  if (from > to) {
    throw createError({ statusCode: 400, statusMessage: 'from must not be after to.' })
  }
  // Jeder Ereignistag kostet einen Saldo-Durchlauf — Obergrenze gegen
  // versehentlich riesige Zeitraeume.
  if (getRangeDays(from, to) > MAX_HISTORY_RANGE_DAYS) {
    throw createError({ statusCode: 400, statusMessage: `Range must not exceed ${MAX_HISTORY_RANGE_DAYS} days.` })
  }

  // Alle Budgets des Haushalts (auch geschlossene), damit Vorgaenger-Ketten
  // aufgeloest werden — wie bei der Saldo-Liste.
  const budgets = await prisma.budget.findMany({
    where: { householdId },
    select: {
      id: true,
      name: true,
      ...budgetBalanceSelect,
      versions: { select: { amount: true, validFrom: true } },
    },
  })

  if (!budgets.some((budget) => budget.id === budgetId)) {
    throw createError({ statusCode: 404, statusMessage: 'Budget not found.' })
  }

  // Die Kette ist unter Vorgaengern abgeschlossen — mehr braucht der
  // Kettensaldo nicht, also auch nur deren Buchungen laden.
  const chain = getBudgetChain(budgets, budgetId)
  const { expenses, transfers } = await loadBudgetBalanceInputs(householdId, chain, { details: true })
  const history = computeBudgetBalanceHistory(chain, expenses, transfers, budgetId, from, to)
  const names = new Map(budgets.map((budget) => [budget.id, budget.name]))

  return {
    budgetId,
    ...history,
    // Namen fuer Ereignis-Beschriftungen ("Übertrag aus Lebensmittel (wöchentlich)").
    chain: chain.map((budget) => ({ id: budget.id, name: names.get(budget.id) ?? '' })),
    events: history.events.map((item) => ({
      ...item,
      budgetName: names.get(item.budgetId) ?? null,
      fromBudgetName: item.fromBudgetId ? names.get(item.fromBudgetId) ?? null : undefined,
    })),
    entries: history.entries.map((item) => ({
      ...item,
      budgetName: names.get(item.budgetId) ?? null,
      fromBudgetName: item.fromBudgetId ? names.get(item.fromBudgetId) ?? null : undefined,
    })),
  }
})
