/*
 * POST /api/households/:householdId/budgets/:id/close
 *
 * Schliesst ein Budget zu einem Stichtag und verweist seinen Saldo auf ein
 * Ziel-Budget (ADR-0004, "Budget schliessen"). Typischer Anlass: Wechsel
 * der Periodizitaet — neues Budget anlegen, altes hinein schliessen.
 *
 * Body: { closedAt: 'YYYY-MM-DD', carryoverToBudgetId: string }
 *
 * Es wird kein Betrag festgeschrieben: Der Saldo des Ziels enthaelt immer
 * den aktuellen Endsaldo dieses Budgets, auch nach spaeteren Korrekturen
 * von Buchungen vor dem Stichtag.
 *
 * Auth: `requireHouseholdOwner` — Schliessen ist Planung.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdOwner } from '../../../../../utils/household-access'
import { defineApiResponse } from '../../../../../utils/api-response'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { assertCanCloseBudget } from '../../../../../utils/budget-lifecycle'

type CloseBudgetBody = {
  closedAt?: string
  carryoverToBudgetId?: string | null
}

const closeSelect = {
  id: true,
  householdId: true,
  frequency: true,
  balanceSince: true,
  closedAt: true,
} as const

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const budgetId = parseUuidParam(event, 'id')

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<CloseBudgetBody>(event)
  const closedAt = parseDateInput(body?.closedAt, 'Closing date')
  const targetId = typeof body?.carryoverToBudgetId === 'string' ? body.carryoverToBudgetId.trim() : ''

  // Ziel ist Pflicht — auch bei Saldo 0 koennte eine Nachbuchung ihn noch
  // veraendern, und dieses Geld darf nicht verschwinden.
  if (!targetId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target budget is required.',
    })
  }

  const [budget, target] = await Promise.all([
    prisma.budget.findFirst({ where: { id: budgetId, householdId }, select: closeSelect }),
    prisma.budget.findFirst({ where: { id: targetId, householdId }, select: closeSelect }),
  ])

  if (!budget) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Budget not found.',
    })
  }

  assertCanCloseBudget(budget, target, closedAt)

  // Buchungen ab dem Stichtag gehoeren fachlich schon zum Nachfolger und
  // waeren nach dem Schliessen weder aenderbar noch neu anlegbar. Der User
  // soll sie erst auf das neue Budget umhaengen. Vergleich ab Mitternacht
  // des Stichtags.
  const closedFrom = new Date(closedAt)
  closedFrom.setHours(0, 0, 0, 0)
  const [laterExpenses, laterTransfers] = await Promise.all([
    prisma.expenseTransaction.count({
      where: { budgetId, deletedAt: null, date: { gte: closedFrom } },
    }),
    prisma.savingsGoalExecution.count({
      where: { sourceBudgetId: budgetId, date: { gte: closedFrom } },
    }),
  ])

  if (laterExpenses > 0 || laterTransfers > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Budget has bookings on or after the closing date. Move them to another budget first.',
    })
  }

  const item = await prisma.$transaction(async (tx) => {
    // Versionen ab dem Stichtag (vorgeplante Betragsaenderungen) koennen
    // nie mehr zuteilen — weg damit, statt das Schliessen zu blockieren.
    await tx.budgetVersion.deleteMany({
      where: { budgetId, validFrom: { gte: closedFrom } },
    })
    return tx.budget.update({
      where: { id: budgetId },
      data: { closedAt, carryoverToBudgetId: targetId },
    })
  })

  return defineApiResponse({ kind: 'budget', item })
})
