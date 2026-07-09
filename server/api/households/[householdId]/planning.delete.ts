import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import { assertPlanningKind } from '../../../utils/planning'
import { parseUuidParam } from '../../../utils/validation'

type PlanningDeleteBody = {
  kind: string
  id: string
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<PlanningDeleteBody>(event)
  const kind = assertPlanningKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Item ID is required.',
    })
  }

  switch (kind) {
    case 'budget':
      if (!(await prisma.budget.findFirst({ where: { id: body.id, householdId } }))) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Budget not found.',
        })
      }
      await prisma.budget.delete({
        where: { id: body.id },
      })
      break
    case 'incomePlan':
      if (!(await prisma.incomePlan.findFirst({ where: { id: body.id, householdId } }))) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Income plan not found.',
        })
      }
      await prisma.incomePlan.delete({
        where: { id: body.id },
      })
      break
    case 'fixedCostPlan':
      if (!(await prisma.fixedCostPlan.findFirst({ where: { id: body.id, householdId } }))) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fixed cost plan not found.',
        })
      }
      await prisma.fixedCostPlan.delete({
        where: { id: body.id },
      })
      break
    case 'savingsGoal':
      if (!(await prisma.savingsGoal.findFirst({ where: { id: body.id, householdId } }))) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Savings goal not found.',
        })
      }
      await prisma.savingsGoal.delete({
        where: { id: body.id },
      })
      break
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported planning kind.',
      })
  }

  return { success: true }
})
