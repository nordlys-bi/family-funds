import { createError, defineEventHandler, getQuery } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { getMonthWindow } from '../../../utils/budget-evaluation'
import { parseUuidParam } from '../../../utils/validation'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

/**
 * GET /api/households/:householdId/transactions
 *
 * Liefert eine monatsbezogene Transaktionsliste plus Summary-Aggregates.
 * Paginierbar:
 *   - `?limit=N`   Anzahl Transaktionen pro Page (Default 200, max 500).
 *                  ?limit=0 und ?limit=501 -> 400.
 *   - `?before=DATE` Cursor — liefert nur Transaktionen mit
 *                  date < DATE. DATE ist ISO-8601 (YYYY-MM-DD oder voll).
 *
 * Date-Bereich bleibt der aktuelle Monat (issue-spec-Anforderung:
 * spaetere `?from&to`-Range ist eigene Iteration). Cursor ist ein
 * date-only Cursor: das letzte Item des Pages liefert `nextCursor`
 * als ISO-Datum seines `date`-Felds. Bei mehreren Transaktionen am
 * gleichen Tag ist die Page etwas groesser als `limit` — das ist
 * akzeptabel, da Haushalte in der Praxis < 50 Buchungen/Tag haben.
 *
 * Antwort erweitert um `hasMore: boolean` + `nextCursor: string | null`.
 * Aeltere Frontend-Aufrufer ohne Cursor bekommen das Default-Limit und
 * ignorieren die neuen Felder (additiv).
 */
export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  const { user } = await requireHouseholdMembership(event, householdId)
  const { monthStart, monthEnd } = getMonthWindow()

  // --- Query-Param-Parsing ---
  const query = getQuery(event)
  let limit = DEFAULT_LIMIT
  if (query.limit !== undefined) {
    const parsed = Number(query.limit)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw createError({
        statusCode: 400,
        statusMessage: `limit must be an integer between 1 and ${MAX_LIMIT}.`,
      })
    }
    limit = parsed
  }

  let beforeDate: Date | null = null
  if (query.before !== undefined) {
    const raw = String(query.before)
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      throw createError({
        statusCode: 400,
        statusMessage: 'before must be a valid ISO date string.',
      })
    }
    beforeDate = parsed
  }

  // Rows werden fuer die Listen-Darstellung gebraucht. Summen kommen
  // separat via `_sum`-Aggregates (Backend-Review Finding #6).
  // Pagination: `take: limit + 1` fuer jeden der beiden Calls — das
  // zusaetzliche Element ermoeglicht `hasMore`-Detektion ohne Count-Query.
  const expenseFilter = {
    householdId,
    date: {
      gte: monthStart,
      lt: monthEnd,
      ...(beforeDate ? { lt: beforeDate } : {}),
    },
  }
  const incomeFilter = {
    householdId,
    date: {
      gte: monthStart,
      lt: monthEnd,
      ...(beforeDate ? { lt: beforeDate } : {}),
    },
  }

  const [expenses, incomes, incomeTotalAggregate, expenseTotalAggregate, unassignedExpenseTotalAggregate] = await Promise.all([
    prisma.expenseTransaction.findMany({
      where: expenseFilter,
      orderBy: {
        date: 'desc',
      },
      take: limit + 1,
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        createdAt: true,
        updatedAt: true,
        budgetId: true,
        budget: {
          select: {
            id: true,
            name: true,
            key: true,
          },
        },
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    }),
    prisma.incomeTransaction.findMany({
      where: incomeFilter,
      orderBy: {
        date: 'desc',
      },
      take: limit + 1,
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
    }),
    prisma.incomeTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.aggregate({
      where: { householdId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.expenseTransaction.aggregate({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        budgetId: null,
      },
      _sum: { amount: true },
    }),
  ])

  const transactions = [
    ...expenses.map((transaction) => ({
      id: transaction.id,
      kind: 'expense' as const,
      amount: transaction.amount,
      description: transaction.description,
      date: transaction.date,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      budgetId: transaction.budgetId,
      budgetName: transaction.budget?.name ?? null,
      budgetKey: transaction.budget?.key ?? null,
      user: transaction.user,
    })),
    ...incomes.map((transaction) => ({
      id: transaction.id,
      kind: 'income' as const,
      amount: transaction.amount,
      description: transaction.description,
      date: transaction.date,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      user: transaction.user,
    })),
  ]
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    // Auf `limit` trunkieren — wir hatten `limit + 1` abgefragt, das
    // zusaetzliche Element dient nur der hasMore-Detection.
    .slice(0, limit)

  const hasMore = expenses.length > limit || incomes.length > limit
  const lastItem = transactions[transactions.length - 1]
  const nextCursor = hasMore && lastItem ? lastItem.date.toISOString() : null

  const incomeTotal = incomeTotalAggregate._sum.amount ?? 0
  const expenseTotal = expenseTotalAggregate._sum.amount ?? 0
  const unassignedExpenseTotal = unassignedExpenseTotalAggregate._sum.amount ?? 0

  return {
    householdId,
    monthStart,
    monthEnd,
    transactions,
    hasMore,
    nextCursor,
    summary: {
      incomeTotal,
      expenseTotal,
      netTotal: incomeTotal - expenseTotal,
      unassignedExpenseTotal,
      visibleForUserId: user.id,
    },
  }
})
