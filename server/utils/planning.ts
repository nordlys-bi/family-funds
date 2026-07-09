import { randomUUID } from 'node:crypto'
import { createError } from 'h3'

export const planningKinds = ['budget', 'incomePlan', 'fixedCostPlan', 'savingsGoal'] as const
export type PlanningKind = (typeof planningKinds)[number]

export const frequencies = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'] as const
export type PlanningFrequency = (typeof frequencies)[number]

export function assertPlanningKind(value: unknown): PlanningKind {
  if (typeof value === 'string' && planningKinds.includes(value as PlanningKind)) {
    return value as PlanningKind
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid planning kind.',
  })
}

export function assertFrequency(value: unknown): PlanningFrequency {
  if (typeof value === 'string' && frequencies.includes(value as PlanningFrequency)) {
    return value as PlanningFrequency
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid frequency.',
  })
}

export function parseMoneyToCents(value: unknown, fieldName: string) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `${fieldName} must be a positive amount.`,
      })
    }

    return Math.round(value * 100)
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required.`,
    })
  }

  const normalized = value.trim().replace(/\s+/g, '')
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required.`,
    })
  }

  let parsedAmount: number

  if (normalized.includes(',') && normalized.includes('.')) {
    const lastComma = normalized.lastIndexOf(',')
    const lastDot = normalized.lastIndexOf('.')

    if (lastComma > lastDot) {
      parsedAmount = Number(normalized.replace(/\./g, '').replace(',', '.'))
    } else {
      parsedAmount = Number(normalized.replace(/,/g, ''))
    }
  } else if (normalized.includes(',')) {
    parsedAmount = Number(normalized.replace(',', '.'))
  } else {
    parsedAmount = Number(normalized)
  }

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a positive amount.`,
    })
  }

  return Math.round(parsedAmount * 100)
}

/**
 * Wie parseMoneyToCents, akzeptiert aber negative Betraege (Withdrawals
 * aus SavingsGoals). Erlaubt sowohl String als auch Number-Input.
 *
 * Beispiel: 12.50 -> 1250, -5 -> -500, "-3,75" -> -375
 */
export function parseExecutionAmount(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${fieldName} must be a finite amount.`,
      })
    }
    return Math.round(value * 100)
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required.`,
    })
  }

  const normalized = value.trim().replace(/\s+/g, '')
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required.`,
    })
  }

  let parsedAmount: number

  // Vorzeichen separat behandeln, damit "−" / "-" am String-Anfang sauber
  // verarbeitet werden (Number() akzeptiert "+", "-", aber nicht
  // "1.234,56" mit Punkt als Tausender UND Komma als Dezimal).
  const sign = normalized.startsWith('-') ? -1 : 1
  const absolute = sign === -1 ? normalized.slice(1) : normalized

  if (absolute.includes(',') && absolute.includes('.')) {
    const lastComma = absolute.lastIndexOf(',')
    const lastDot = absolute.lastIndexOf('.')

    if (lastComma > lastDot) {
      parsedAmount = Number(absolute.replace(/\./g, '').replace(',', '.'))
    } else {
      parsedAmount = Number(absolute.replace(/,/g, ''))
    }
  } else if (absolute.includes(',')) {
    parsedAmount = Number(absolute.replace(',', '.'))
  } else {
    parsedAmount = Number(absolute)
  }

  if (!Number.isFinite(parsedAmount)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a finite amount.`,
    })
  }

  return sign === -1 ? -Math.round(parsedAmount * 100) : Math.round(parsedAmount * 100)
}

export function parseDateInput(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is required.`,
    })
  }

  const date = new Date(`${value}T12:00:00`)

  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} is invalid.`,
    })
  }

  return date
}

export function parseOptionalDateInput(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid date value.',
    })
  }

  return parseDateInput(value, 'Date')
}

export function isPeriodStart(date: Date, frequency: PlanningFrequency) {
  switch (frequency) {
    case 'WEEKLY':
      return date.getDay() === 1
    case 'MONTHLY':
      return date.getDate() === 1
    case 'QUARTERLY':
      return date.getDate() === 1 && [0, 3, 6, 9].includes(date.getMonth())
    case 'YEARLY':
      return date.getDate() === 1 && date.getMonth() === 0
    case 'ONCE':
      return true
  }
}

export function assertPeriodStart(date: Date, frequency: PlanningFrequency, fieldName = 'validFrom') {
  if (!isPeriodStart(date, frequency)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must match the start of the selected period.`,
    })
  }
}

export function generateBudgetKey() {
  return `budget_${randomUUID().replace(/-/g, '')}`
}
