/**
 * Regeln rund um geschlossene Budgets (ADR-0004, "Budget schliessen").
 *
 * Reine Funktionen (werfen h3-Fehler), damit Endpoints und Tests dieselbe
 * Pruefung nutzen. Vergleiche laufen tagesgenau — Daten liegen auf 12:00
 * Serverzeit (`parseDateInput`), Executions ohne Datum aber auf "jetzt".
 */
import { createError } from 'h3'
import type { Frequency } from '@prisma/client'
import { isPeriodStart } from './planning'

function dayKey(date: Date) {
  const value = new Date(date)
  value.setHours(12, 0, 0, 0)
  return value.getTime()
}

/** Ist das Budget am Tag `date` noch offen (Stichtag exklusiv)? */
export function isBudgetOpenOn(budget: { closedAt: Date | null }, date: Date) {
  return !budget.closedAt || dayKey(date) < dayKey(budget.closedAt)
}

/**
 * Ab dem Stichtag keine Ausgaben, Umbuchungen oder Versionen mehr auf ein
 * geschlossenes Budget — sein Endsaldo ist bereits ins Ziel geflossen, eine
 * spaetere Buchung wuerde dort unbemerkt mitwandern. Buchungen VOR dem
 * Stichtag bleiben erlaubt (Nachbuchungen sollen weiterfliessen).
 */
export function assertBudgetOpenOn(budget: { closedAt: Date | null }, date: Date) {
  if (!isBudgetOpenOn(budget, date)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Budget is closed on this date.',
    })
  }
}

type CloseBudget = {
  id: string
  householdId: string
  frequency: Frequency
  balanceSince: Date
  closedAt: Date | null
}

/**
 * Validiert das Schliessen von `budget` zum Stichtag `closedAt` in `target`.
 *
 * - Stichtag ist ein Periodenbeginn der Frequenz des geschlossenen Budgets,
 *   damit keine Periode voll zugeteilt, aber nur teilweise genutzt wird.
 * - Ziel ist Pflicht, im selben Haushalt, nicht das Budget selbst und zum
 *   Stichtag noch offen. Letzteres schliesst Zyklen aus: ein frueher
 *   geschlossenes Budget kann kein Ziel eines spaeter geschlossenen sein.
 * - Wiederoeffnen/erneutes Schliessen ist nicht vorgesehen.
 */
export function assertCanCloseBudget(budget: CloseBudget, target: CloseBudget | null, closedAt: Date) {
  if (budget.closedAt) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Budget is already closed.',
    })
  }

  if (!isPeriodStart(closedAt, budget.frequency)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Closing date must match the start of a budget period.',
    })
  }

  if (dayKey(closedAt) < dayKey(budget.balanceSince)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Closing date must not be before the balance start.',
    })
  }

  if (!target || target.householdId !== budget.householdId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Target budget not found.',
    })
  }

  if (target.id === budget.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A budget cannot be closed into itself.',
    })
  }

  if (!isBudgetOpenOn(target, closedAt)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target budget must still be open on the closing date.',
    })
  }
}
