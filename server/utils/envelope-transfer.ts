/**
 * Eingabe-Pruefung fuer Umbuchungen (ADR-0005). Gemeinsam fuer POST und
 * PATCH, damit beide dieselben Regeln durchsetzen.
 */
import { createError } from 'h3'
import { prisma } from './prisma'
import { assertEnvelopeOpenOn } from './envelope-lifecycle'

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
 * jeder Umschlag gehoert zum Haushalt und ist am Buchungstag offen.
 */
export async function assertTransferSides(householdId: string, sides: TransferSides, date: Date) {
  if (sides.fromEnvelopeId === null && sides.toEnvelopeId === null) {
    throw createError({ statusCode: 400, statusMessage: 'A transfer needs at least one envelope.' })
  }
  if (sides.fromEnvelopeId === sides.toEnvelopeId) {
    throw createError({ statusCode: 400, statusMessage: 'Source and target must differ.' })
  }
  const ids = [sides.fromEnvelopeId, sides.toEnvelopeId].filter((id): id is string => id !== null)
  const envelopes = await prisma.envelope.findMany({
    where: { householdId, id: { in: ids } },
    select: { id: true, closedAt: true },
  })
  for (const id of ids) {
    const envelope = envelopes.find((item) => item.id === id)
    if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
    assertEnvelopeOpenOn(envelope, date)
  }
}

/**
 * Prueft den Umschlag einer Ausgabe oder Einnahme: gehoert zum Haushalt und
 * ist am Buchungstag offen. `null` = "Zu verteilen", immer erlaubt.
 */
export async function assertBookingEnvelope(householdId: string, envelopeId: string | null, date: Date) {
  if (!envelopeId) return
  const envelope = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { closedAt: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  assertEnvelopeOpenOn(envelope, date)
}

/**
 * Umschlag eines Fixkosten- oder Einnahmen-Plans: `envelopeId`, sonst der
 * alte Name `budgetId` (bis #159). `undefined` = nicht angegeben.
 */
export async function parsePlanEnvelope(
  householdId: string,
  body: { envelopeId?: string | null; budgetId?: string | null },
): Promise<string | null | undefined> {
  const raw = body.envelopeId !== undefined ? body.envelopeId : body.budgetId
  if (raw === undefined) return undefined
  const envelopeId = raw?.trim() || null
  if (envelopeId) {
    const envelope = await prisma.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { id: true } })
    if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  }
  return envelopeId
}
