/**
 * Eingabe-Pruefung fuer Umbuchungen (ADR-0005). Gemeinsam fuer POST und
 * PATCH, damit beide dieselben Regeln durchsetzen.
 */
import { createError } from 'h3'
import { prisma } from './prisma'
import { assertEnvelopeAcceptsBooking } from './envelope-lifecycle'
import { dayKey } from './period'

export type TransferSides = {
  fromEnvelopeId: string | null
  toEnvelopeId: string | null
}

/** `undefined` = nicht angegeben, `null`/'' = "Zu verteilen". */
export function parseEnvelopeSide(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid envelope id.' })
  return value.trim() || null
}

/**
 * Prueft beide Seiten: mindestens eine ist ein Umschlag, beide verschieden,
 * jeder Umschlag gehoert zum Haushalt und nimmt am Buchungstag Buchungen an.
 */
export async function assertTransferSides(householdId: string, sides: TransferSides, date: Date) {
  if (sides.fromEnvelopeId === null && sides.toEnvelopeId === null) {
    throw createError({ statusCode: 400, statusMessage: 'A transfer needs at least one envelope.' })
  }
  if (sides.fromEnvelopeId === sides.toEnvelopeId) {
    throw createError({ statusCode: 400, statusMessage: 'Source and target must differ.' })
  }
  // Vor dem Start von "Zu verteilen" zaehlt nur die Umschlag-Seite: Der Saldo
  // aenderte sich, ohne dass "Zu verteilen" es merkt. Das verfaelscht den
  // Bestand zum Stichtag, deshalb hier wie bei Zuteilungen ausgeschlossen.
  if (sides.fromEnvelopeId === null || sides.toEnvelopeId === null) {
    const { ledgerSince } = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true } })
    if (dayKey(date) < dayKey(ledgerSince)) {
      throw createError({ statusCode: 400, statusMessage: 'Date is before the start of "Zu verteilen".', data: { reason: 'before-ledger' } })
    }
  }
  const ids = [sides.fromEnvelopeId, sides.toEnvelopeId].filter((id): id is string => id !== null)
  const envelopes = await prisma.envelope.findMany({
    where: { householdId, id: { in: ids } },
    select: { id: true, closedAt: true, balanceSince: true },
  })
  for (const id of ids) {
    const envelope = envelopes.find((item) => item.id === id)
    if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
    assertEnvelopeAcceptsBooking(envelope, date)
  }
}

/**
 * Prueft den Umschlag einer Ausgabe oder Einnahme: gehoert zum Haushalt und
 * nimmt am Buchungstag Buchungen an. `null` = "Zu verteilen", immer erlaubt:
 * Vor `ledgerSince` zaehlt so eine Buchung nur in den Auswertungen (ADR-0005),
 * das Nacherfassen alter Belege bleibt damit moeglich.
 */
export async function assertBookingEnvelope(householdId: string, envelopeId: string | null, date: Date) {
  if (!envelopeId) return
  const envelope = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { closedAt: true, balanceSince: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  assertEnvelopeAcceptsBooking(envelope, date)
}

/** Umschlag eines Fixkosten- oder Einnahmen-Plans. `undefined` = nicht angegeben. */
export async function parsePlanEnvelope(
  householdId: string,
  body: { envelopeId?: string | null },
): Promise<string | null | undefined> {
  if (body.envelopeId === undefined) return undefined
  const envelopeId = body.envelopeId?.trim() || null
  if (envelopeId) {
    const envelope = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { id: true } })
    if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  }
  return envelopeId
}
