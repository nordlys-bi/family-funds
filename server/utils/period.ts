/**
 * Periodenraster und tagesgenaue Vergleiche.
 *
 * Datumswerte liegen auf "Mittag" (12:00 Serverzeit, `parseDateInput`), damit
 * ein Tag nicht durch Zeitzonen oder Uhrzeiten verrutscht. Alle Vergleiche
 * laufen deshalb ueber `dayKey`.
 */
import type { Frequency } from '@prisma/client'

export type PeriodSeverity = 'ok' | 'warning' | 'over'

/** Tagesgenauer Vergleichsschluessel (12:00 Serverzeit). */
export function dayKey(date: Date) {
  const value = new Date(date)
  value.setHours(12, 0, 0, 0)
  return value.getTime()
}

function startOfDay(date: Date) {
  return new Date(dayKey(date))
}

export function getMonthWindow(baseDate = new Date()) {
  const monthStart = startOfDay(baseDate)
  monthStart.setDate(1)

  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  return { monthStart, monthEnd }
}

export function startOfPeriod(date: Date, frequency: Frequency) {
  const value = startOfDay(date)

  switch (frequency) {
    case 'WEEKLY': {
      const day = value.getDay()
      const offset = day === 0 ? -6 : 1 - day
      value.setDate(value.getDate() + offset)
      break
    }
    case 'MONTHLY':
      value.setDate(1)
      break
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(value.getMonth() / 3) * 3
      value.setMonth(quarterStartMonth, 1)
      break
    }
    case 'YEARLY':
      value.setMonth(0, 1)
      break
    case 'ONCE':
      break
  }

  return value
}

export function addPeriod(date: Date, frequency: Frequency) {
  const value = startOfDay(date)

  switch (frequency) {
    case 'WEEKLY':
      value.setDate(value.getDate() + 7)
      break
    case 'MONTHLY':
      value.setMonth(value.getMonth() + 1, 1)
      break
    case 'QUARTERLY':
      value.setMonth(value.getMonth() + 3, 1)
      break
    case 'YEARLY':
      value.setFullYear(value.getFullYear() + 1, 0, 1)
      break
    case 'ONCE':
      value.setTime(Number.POSITIVE_INFINITY)
      break
  }

  return value
}
