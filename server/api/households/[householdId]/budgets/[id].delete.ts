/*
 * DELETE /api/households/:householdId/budgets/:id
 *
 * Loescht ein Budget (inkl. aller Versionen via Cascade). Path-Param
 * ist die ID, kein `kind`-Body mehr (issue #27 Finding A).
 *
 * Auth: `requireHouseholdOwner` — nur Owner duerfen Planning-Items
 * verwalten.
 *
 * ADR-0004: Loeschen nur, solange das Budget keine Spuren hat — sonst
 * verschwaende sein Saldo samt realem Geld aus der App. Mit Spuren → 409,
 * das Budget muss stattdessen geschlossen werden:
 *   - keine ExpenseTransaction, auch keine soft-geloeschte (deren
 *     Wiederherstellung brächte sonst eine Buchung ohne Budget zurueck),
 *   - keine Umbuchung in einen Spartopf (`sourceBudgetId`),
 *   - kein Vorgaenger, der in dieses Budget geschlossen wurde.
 */
import { createError, defineEventHandler } from 'h3'
import { prisma } from '../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const budgetId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const existing = await prisma.budget.findFirst({
    where: { id: budgetId, householdId },
    select: { id: true },
  })

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Budget not found.',
    })
  }

  const [expenseCount, transferCount, predecessorCount] = await Promise.all([
    prisma.expenseTransaction.count({ where: { budgetId } }),
    prisma.savingsGoalExecution.count({ where: { sourceBudgetId: budgetId } }),
    prisma.budget.count({ where: { carryoverToBudgetId: budgetId } }),
  ])

  if (expenseCount > 0 || transferCount > 0 || predecessorCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Budget has bookings and cannot be deleted. Close it instead.',
    })
  }

  await prisma.budget.delete({ where: { id: budgetId } })

  return defineApiResponse({ kind: 'budget', deleted: true })
})