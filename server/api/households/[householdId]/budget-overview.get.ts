/*
 * GET /api/households/:id/budget-overview
 *
 * Aggregierte Budget-Auslastung fuer einen Monat. Optional ?month=YYYY-MM,
 * Default = aktueller Monat (getMonthWindow).
 *
 * Liefert nur die `budgetOverview`-Summary der Dashboard-Logik, ohne den
 * kompletten Household-Graph zu laden. Auth: MEMBERSHIP.
 *
 * Query-Param-Validierung: ?month muss YYYY-MM Format sein, sonst 400.
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdMembership } from '../../../utils/household-access'
import { buildBudgetOverview, getMonthWindow } from '../../../utils/budget-evaluation'
import { parseUuidParam } from '../../../utils/validation'

const MONTH_REGEX = /^\d{4}-\d{2}$/

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdMembership(event, householdId)

  const query = getQuery(event)
  let monthStart: Date
  let monthEnd: Date

  if (query.month !== undefined) {
    const raw = String(query.month)
    if (!MONTH_REGEX.test(raw)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'month must be in YYYY-MM format.',
      })
    }
    const [yearStr, monthStr] = raw.split('-')
    const year = Number(yearStr)
    const monthIdx = Number(monthStr) - 1 // 0-basiert
    // Range-Check: Monat 1-12, und Jahr im realistischen Bereich.
    // Verhindert "2026-13" (regex \d{2} matched "13" als monthStr).
    if (monthIdx < 0 || monthIdx > 11) {
      throw createError({
        statusCode: 400,
        statusMessage: 'month part must be between 01 and 12.',
      })
    }
    if (!Number.isInteger(year) || year < 1900 || year > 3000) {
      throw createError({
        statusCode: 400,
        statusMessage: 'year part must be a 4-digit year between 1900 and 3000.',
      })
    }
    monthStart = new Date(year, monthIdx, 1, 0, 0, 0, 0)
    monthEnd = new Date(year, monthIdx + 1, 1, 0, 0, 0, 0)
  } else {
    const { monthStart: ms, monthEnd: me } = getMonthWindow()
    monthStart = ms
    monthEnd = me
  }

  const [budgets, expenses] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId },
      select: {
        id: true,
        key: true,
        name: true,
        versions: {
          orderBy: { validFrom: 'desc' },
          select: {
            id: true,
            amount: true,
            frequency: true,
            validFrom: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.expenseTransaction.findMany({
      where: {
        householdId,
        date: { gte: monthStart, lt: monthEnd },
        // Soft-Delete (issue #58): nur aktive Buchungen aggregieren.
        // Eine soft-deletete Buchung ist aus der UX-Sicht weg, das
        // Budget muss zurueckgerechnet sein. Ohne den Filter wuerde
        // die Buchung fuer 5 Sek (Undo-Fenster) oder permanent
        // (deletedAt bleibt in der DB) weiterhin in die Auslastung
        // einfliesen. Issue #65.
        deletedAt: null,
      },
      select: { amount: true, date: true, budgetId: true },
    }),
  ])

  const budgetOverview = buildBudgetOverview(budgets, expenses, monthStart)

  return {
    householdId,
    monthStart,
    monthEnd,
    budgetOverview,
  }
})
