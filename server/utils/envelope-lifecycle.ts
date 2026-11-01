/**
 * Regeln und Eingabe-Parsing fuer Umschlaege (ADR-0005).
 *
 * Schliessen und Offenheit wie bei Budgets (ADR-0004, `budget-lifecycle.ts`),
 * mit einer Erweiterung: Ziel des Uebertrags kann auch "Zu verteilen" sein
 * (`target = null`). Reine Funktionen, die h3-Fehler werfen, damit Endpoints
 * und Tests dieselbe Pruefung nutzen.
 */
import { createError } from 'h3'
import type { AllocationSource, EnvelopeGroup, Frequency } from '@prisma/client'
import { dayKey } from './budget-balance'
import { isPeriodStart, parseMoneyToCents } from './planning'

export const envelopeGroups = ['RUNNING', 'FIXED', 'RESERVE', 'SAVINGS', 'PERSONAL'] as const satisfies readonly EnvelopeGroup[]
export const allocationSources = ['NONE', 'FIXED', 'PLANS'] as const satisfies readonly AllocationSource[]

/**
 * Vorgabe je Gruppe, wenn beim Anlegen keine Zuteilungsquelle kommt. Nur
 * eine Vorgabe — jede Gruppe darf jede Quelle haben (ADR-0005, "Gruppen").
 */
export const defaultAllocationSource: Record<EnvelopeGroup, AllocationSource> = {
  RUNNING: 'FIXED',
  FIXED: 'PLANS',
  RESERVE: 'FIXED',
  SAVINGS: 'NONE',
  PERSONAL: 'NONE',
}

export function parseEnvelopeGroup(value: unknown): EnvelopeGroup {
  if (typeof value === 'string' && (envelopeGroups as readonly string[]).includes(value)) return value as EnvelopeGroup
  throw createError({ statusCode: 400, statusMessage: `Group must be one of ${envelopeGroups.join(', ')}.` })
}

export function parseAllocationSource(value: unknown): AllocationSource {
  if (typeof value === 'string' && (allocationSources as readonly string[]).includes(value)) return value as AllocationSource
  throw createError({ statusCode: 400, statusMessage: `Allocation source must be one of ${allocationSources.join(', ')}.` })
}

/**
 * Geldbetrag in Cent, der auch 0 sein darf (ausgelassene Zuteilung, Ziel 0).
 * Sonst wie `parseMoneyToCents`.
 */
export function parseMoneyToCentsAllowZero(value: unknown, fieldName: string): number {
  if (value === 0 || (typeof value === 'string' && /^\s*0+([.,]0*)?\s*$/.test(value))) return 0
  return parseMoneyToCents(value, fieldName)
}

/**
 * Zuteilungsquelle und -betrag gemeinsam pruefen: FIXED braucht einen
 * Betrag, PLANS geht nur mit periodischer Frequenz (ein ONCE-Umschlag hat
 * kein Raster, auf das sich Plaene umlegen liessen).
 */
export function assertAllocationRule(frequency: Frequency, source: AllocationSource, amount: number | null) {
  if (source === 'FIXED' && amount === null) {
    throw createError({ statusCode: 400, statusMessage: 'A fixed allocation needs an amount.' })
  }
  if (source === 'PLANS' && frequency === 'ONCE') {
    throw createError({ statusCode: 400, statusMessage: 'Allocations from plans need a recurring frequency.' })
  }
}

/** Ist der Umschlag am Tag `date` noch offen (Stichtag exklusiv)? */
export function isEnvelopeOpenOn(envelope: { closedAt: Date | null }, date: Date) {
  return !envelope.closedAt || dayKey(date) < dayKey(envelope.closedAt)
}

/**
 * Ab dem Stichtag keine Buchungen mehr auf einen geschlossenen Umschlag —
 * sein Endsaldo ist bereits weitergeflossen, eine spaetere Buchung wuerde
 * dort unbemerkt mitwandern. Buchungen VOR dem Stichtag bleiben erlaubt.
 */
export function assertEnvelopeOpenOn(envelope: { closedAt: Date | null }, date: Date) {
  if (!isEnvelopeOpenOn(envelope, date)) {
    throw createError({ statusCode: 400, statusMessage: 'Envelope is closed on this date.' })
  }
}

type CloseEnvelope = {
  id: string
  householdId: string
  frequency: Frequency
  balanceSince: Date
  closedAt: Date | null
}

/**
 * Validiert das Schliessen von `envelope` zum Stichtag `closedAt` in
 * `target` (null = "Zu verteilen").
 *
 * - Stichtag ist ein Periodenbeginn, damit keine Periode zugeteilt, aber nur
 *   teilweise genutzt wird, und nicht vor dem Startpunkt.
 * - Ein Ziel-Umschlag liegt im selben Haushalt, ist nicht der Umschlag
 *   selbst und zum Stichtag noch offen — das schliesst Zyklen aus.
 * - Wiederoeffnen/erneutes Schliessen ist nicht vorgesehen.
 *
 * `targetRequested` unterscheidet "Zu verteilen gewaehlt" von "Ziel-ID
 * angegeben, aber nicht gefunden".
 */
export function assertCanCloseEnvelope(
  envelope: CloseEnvelope,
  target: CloseEnvelope | null,
  closedAt: Date,
  targetRequested: boolean,
) {
  if (envelope.closedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Envelope is already closed.' })
  }
  if (!isPeriodStart(closedAt, envelope.frequency)) {
    throw createError({ statusCode: 400, statusMessage: 'Closing date must match the start of a period.' })
  }
  if (dayKey(closedAt) < dayKey(envelope.balanceSince)) {
    throw createError({ statusCode: 400, statusMessage: 'Closing date must not be before the balance start.' })
  }
  if (!targetRequested) return
  if (!target || target.householdId !== envelope.householdId) {
    throw createError({ statusCode: 404, statusMessage: 'Target envelope not found.' })
  }
  if (target.id === envelope.id) {
    throw createError({ statusCode: 400, statusMessage: 'An envelope cannot be closed into itself.' })
  }
  if (!isEnvelopeOpenOn(target, closedAt)) {
    throw createError({ statusCode: 400, statusMessage: 'Target envelope must still be open on the closing date.' })
  }
}
