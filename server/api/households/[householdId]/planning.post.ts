import { defineEventHandler, createError, readBody } from 'h3'
import { prisma } from '../../../utils/prisma'
import { requireHouseholdOwner } from '../../../utils/household-access'
import {
  assertFrequency,
  assertPlanningKind,
  assertPeriodStart,
  generateBudgetKey,
  parseDateInput,
  parseMoneyToCents,
  parseOptionalDateInput,
} from '../../../utils/planning'

type PlanningCreateBody = {
  kind: string
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
  const householdId = event.context.params?.householdId

  if (!householdId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Household ID is required.',
    })
  }

  await requireHouseholdOwner(event, householdId)

  const body = await readBody<PlanningCreateBody>(event)
  const kind = assertPlanningKind(body.kind)
  const name = body.name?.trim()

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name is required.',
    })
  }

  switch (kind) {
    case 'budget': {
      const amount = parseMoneyToCents(body.amount, 'Amount')
      const frequency = assertFrequency(body.frequency)
      const validFrom = parseDateInput(body.validFrom, 'Valid from')
      assertPeriodStart(validFrom, frequency, 'Valid from')

      const item = await prisma.budget.create({
        data: {
          householdId,
          key: generateBudgetKey(),
          name,
          versions: {
            create: {
              amount,
              frequency,
              validFrom,
            },
          },
        },
      })

      return { kind, item }
    }
    case 'incomePlan': {
      const amount = parseMoneyToCents(body.amount, 'Amount')
      const frequency = assertFrequency(body.frequency)
      const startDate = parseDateInput(body.startDate, 'Start date')
      const endDate = parseOptionalDateInput(body.endDate)

      const item = await prisma.incomePlan.create({
        data: {
          householdId,
          name,
          amount,
          frequency,
          startDate,
          endDate,
        },
      })

      return { kind, item }
    }
    case 'fixedCostPlan': {
      const amount = parseMoneyToCents(body.amount, 'Amount')
      const frequency = assertFrequency(body.frequency)
      const startDate = parseDateInput(body.startDate, 'Start date')
      const endDate = parseOptionalDateInput(body.endDate)

      const item = await prisma.fixedCostPlan.create({
        data: {
          householdId,
          name,
          amount,
          frequency,
          startDate,
          endDate,
        },
      })

      return { kind, item }
    }
    case 'savingsGoal': {
      const targetAmount = parseMoneyToCents(body.targetAmount, 'Target amount')
      const monthlyRate = parseMoneyToCents(body.monthlyRate, 'Monthly rate')
      const startDate = parseDateInput(body.startDate, 'Start date')
      const endDate = parseOptionalDateInput(body.endDate)

      const item = await prisma.savingsGoal.create({
        data: {
          householdId,
          name,
          targetAmount,
          monthlyRate,
          startDate,
          endDate,
        },
      })

      return { kind, item }
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported planning kind.',
      })
  }
})
