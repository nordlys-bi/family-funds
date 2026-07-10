import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import {
  assertFrequency,
  assertPlanningKind,
  assertPeriodStart,
  parseDateInput,
  parseMoneyToCents,
  parseOptionalDateInput,
} from '../../../utils/planning'
import { defineApiResponse } from '../../../utils/api-response'
import { parseUuidParam } from '../../../utils/validation'

type PlanningUpdateBody = {
  kind: string
  id: string
  name?: string
  amount?: string | number
  frequency?: string
  validFrom?: string
  targetAmount?: string | number
  monthlyRate?: string | number
  startDate?: string
  endDate?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<PlanningUpdateBody>(event)
  const kind = assertPlanningKind(body.kind)

  if (!body.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Item ID is required.',
    })
  }

  const name = body.name?.trim()

  switch (kind) {
    case 'budget': {
      const existing = await prisma.budget.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Budget not found.',
        })
      }

      if (body.amount === undefined) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Amount is required.',
        })
      }

      if (!body.frequency) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Frequency is required.',
        })
      }

      if (!body.validFrom) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Valid from is required.',
        })
      }

      const frequency = assertFrequency(body.frequency)
      const validFrom = parseDateInput(body.validFrom, 'Valid from')
      assertPeriodStart(validFrom, frequency, 'Valid from')
      const amount = parseMoneyToCents(body.amount, 'Amount')

      const item = await prisma.$transaction(async (tx) => {
        if (name) {
          await tx.budget.update({
            where: { id: body.id },
            data: { name },
          })
        }

        // upsert statt create: zwei parallele PATCHes mit demselben validFrom
        // würden sonst P2002 werfen -> 500. Upsert nimmt das vorhandene Row
        // und merged amount/frequency statt zu kollidieren.
        return tx.budgetVersion.upsert({
          where: {
            budgetId_validFrom: {
              budgetId: body.id,
              validFrom,
            },
          },
          create: {
            budgetId: body.id,
            amount,
            frequency,
            validFrom,
          },
          update: {
            amount,
            frequency,
          },
        })
      })

      return defineApiResponse({ kind, item })
    }
    case 'incomePlan': {
      const existing = await prisma.incomePlan.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Income plan not found.',
        })
      }

      const item = await prisma.incomePlan.update({
        where: { id: body.id },
        data: {
          ...(name ? { name } : {}),
          ...(body.amount !== undefined ? { amount: parseMoneyToCents(body.amount, 'Amount') } : {}),
          ...(body.frequency ? { frequency: assertFrequency(body.frequency) } : {}),
          ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
          ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
        },
      })

      return defineApiResponse({ kind, item })
    }
    case 'fixedCostPlan': {
      const existing = await prisma.fixedCostPlan.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Fixed cost plan not found.',
        })
      }

      const item = await prisma.fixedCostPlan.update({
        where: { id: body.id },
        data: {
          ...(name ? { name } : {}),
          ...(body.amount !== undefined ? { amount: parseMoneyToCents(body.amount, 'Amount') } : {}),
          ...(body.frequency ? { frequency: assertFrequency(body.frequency) } : {}),
          ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
          ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
        },
      })

      return defineApiResponse({ kind, item })
    }
    case 'savingsGoal': {
      const existing = await prisma.savingsGoal.findFirst({
        where: {
          id: body.id,
          householdId,
        },
      })

      if (!existing) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Savings goal not found.',
        })
      }

      const item = await prisma.savingsGoal.update({
        where: { id: body.id },
        data: {
          ...(name ? { name } : {}),
          ...(body.targetAmount !== undefined
            ? { targetAmount: parseMoneyToCents(body.targetAmount, 'Target amount') }
            : {}),
          ...(body.monthlyRate !== undefined
            ? { monthlyRate: parseMoneyToCents(body.monthlyRate, 'Monthly rate') }
            : {}),
          ...(body.startDate ? { startDate: parseDateInput(body.startDate, 'Start date') } : {}),
          ...(body.endDate !== undefined ? { endDate: parseOptionalDateInput(body.endDate) } : {}),
        },
      })

      return defineApiResponse({ kind, item })
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported planning kind.',
      })
  }
})
