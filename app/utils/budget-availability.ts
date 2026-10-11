/**
 * Budget-Auswahl beim Buchen (ADR-0004): Ein geschlossenes Budget nimmt ab
 * seinem Stichtag (`closedAt`, exklusiv) keine Ausgaben und Umbuchungen
 * mehr an. Die Auswahl wird deshalb nach Buchungsdatum gefiltert — der
 * Server validiert dasselbe, hier geht es nur darum, gar nicht erst eine
 * Option anzubieten, die mit 400 endet.
 */
import { getPeriodStartDate } from './planning-format'
import type { Frequency } from '~/types/planning'

type ClosableBudget = { closedAt?: string | Date | null }

function dayKey(value: string | Date) {
  // Reines 'YYYY-MM-DD' (Formular-Format) als LOKALEN Tag lesen — `new Date`
  // interpretiert es sonst als UTC-Mitternacht und westlich von UTC als Vortag.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

/** Ist das Budget am Tag `date` noch buchbar? Tagesgenau, Stichtag exklusiv. */
export function isBudgetOpenOn(budget: ClosableBudget, date: string | Date): boolean {
  return !budget.closedAt || dayKey(date) < dayKey(budget.closedAt)
}

/** Filtert auf die am Buchungsdatum noch offenen Budgets. */
export function budgetsOpenOn<T extends ClosableBudget>(budgets: T[], date: string | Date | null | undefined): T[] {
  if (!date) return budgets.filter((budget) => !budget.closedAt)
  return budgets.filter((budget) => isBudgetOpenOn(budget, date))
}

/**
 * Naechster Periodenbeginn nach `value` — Default-Stichtag im
 * Schliessen-Dialog, damit die laufende Periode noch voll genutzt wird.
 * ONCE hat kein Raster, dort ist jeder Tag gueltig (→ morgen).
 */
export function getNextPeriodStartDate(value: Date, frequency: Frequency): Date {
  const start = getPeriodStartDate(value, frequency)
  switch (frequency) {
    case 'WEEKLY':
      start.setDate(start.getDate() + 7)
      break
    case 'MONTHLY':
      start.setMonth(start.getMonth() + 1, 1)
      break
    case 'QUARTERLY':
      start.setMonth(start.getMonth() + 3, 1)
      break
    case 'YEARLY':
      start.setFullYear(start.getFullYear() + 1, 0, 1)
      break
    case 'ONCE':
      start.setDate(start.getDate() + 1)
      break
  }
  return start
}
