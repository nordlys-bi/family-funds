/*
 * GET /api/households/:householdId/envelopes/:id/history?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Saldo-Verlauf eines Umschlags inkl. Vorgaenger-Kette (ADR-0005):
 * Tagesend-Salden und Ereignisse (Zuteilungen, Einnahmen, Ausgaben,
 * Umbuchungen, Uebertraege) im Zeitraum. Default: die letzten 3 Monate bis
 * heute. Bucht vorher faellige Zuteilungen.
 *
 * Auth: MEMBERSHIP.
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { prisma } from '../../../../../utils/prisma'
import { requireHouseholdMembership } from '../../../../../utils/household-access'
import { parseUuidParam } from '../../../../../utils/validation'
import { parseDateInput } from '../../../../../utils/planning'
import { getDefaultHistoryRange, getRangeDays, MAX_HISTORY_RANGE_DAYS } from '../../../../../utils/budget-balance-history'
import { ensureAllocations, envelopeBalanceSelect } from '../../../../../utils/envelope-store'
import { computeEnvelopeHistoryPoints, getEnvelopeChain, listEnvelopeHistoryEntries } from '../../../../../utils/envelope-history'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseOptionalDay(value: unknown, fieldName: string): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${fieldName} must be YYYY-MM-DD.` })
  }
  return parseDateInput(value, fieldName)
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const envelopeId = parseUuidParam(event, 'id')
  await requireHouseholdMembership(event, householdId)

  const query = getQuery(event)
  const defaults = getDefaultHistoryRange()
  const requestedTo = parseOptionalDay(query.to, 'to')
  // Kein Blick in die Zukunft: kuenftige Zuteilungen sind noch nicht gebucht.
  const to = requestedTo && requestedTo < defaults.to ? requestedTo : defaults.to
  const from = parseOptionalDay(query.from, 'from') ?? (() => {
    const value = new Date(to)
    value.setMonth(value.getMonth() - 3)
    return value
  })()
  if (from > to) throw createError({ statusCode: 400, statusMessage: 'from must not be after to.' })
  // Jeder Tag kostet einen Saldo-Durchlauf — Obergrenze gegen riesige Zeitraeume.
  if (getRangeDays(from, to) > MAX_HISTORY_RANGE_DAYS) {
    throw createError({ statusCode: 400, statusMessage: `Range must not exceed ${MAX_HISTORY_RANGE_DAYS} days.` })
  }

  await ensureAllocations(householdId)
  const envelopes = await prisma.envelope.findMany({
    where: { householdId },
    select: { ...envelopeBalanceSelect, name: true },
  })
  if (!envelopes.some((envelope) => envelope.id === envelopeId)) {
    throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  }
  const chain = getEnvelopeChain(envelopes, envelopeId)
  const chainIds = chain.map((envelope) => envelope.id)

  const [expenses, incomes, transfers] = await Promise.all([
    prisma.expenseTransaction.findMany({
      where: { householdId, envelopeId: { in: chainIds }, deletedAt: null },
      select: { id: true, envelopeId: true, amount: true, date: true, description: true },
    }),
    prisma.incomeTransaction.findMany({
      where: { householdId, envelopeId: { in: chainIds }, deletedAt: null },
      select: { id: true, envelopeId: true, amount: true, date: true, description: true },
    }),
    prisma.envelopeTransfer.findMany({
      where: { householdId, OR: [{ fromEnvelopeId: { in: chainIds } }, { toEnvelopeId: { in: chainIds } }] },
      select: { id: true, fromEnvelopeId: true, toEnvelopeId: true, amount: true, date: true, note: true, allocationPeriodStart: true },
    }),
  ])
  const inputs = { expenses, incomes, transfers }
  const names = new Map(envelopes.map((envelope) => [envelope.id, envelope.name]))

  return {
    envelopeId,
    from,
    to,
    chain: chain.map((envelope) => ({ id: envelope.id, name: envelope.name, closedAt: envelope.closedAt })),
    points: computeEnvelopeHistoryPoints(chain, inputs, from, to),
    entries: listEnvelopeHistoryEntries(chain, inputs, from, to).map((entry) => ({
      ...entry,
      counterpartName: entry.counterpartId ? names.get(entry.counterpartId) ?? null : null,
    })),
  }
})
