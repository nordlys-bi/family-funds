/**
 * DB-Anbindung fuer Umschlaege (ADR-0005): faellige Zuteilungen buchen und
 * Salden laden. Getrennt von `envelope-balance.ts` und
 * `envelope-allocations.ts`, damit die Rechenlogik ohne Prisma-Mock
 * testbar bleibt.
 */
import type { AllocationSource, Frequency, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { getAllocationBookingDate, listDueAllocations, type AllocationEnvelope, type AllocationRule } from './envelope-allocations'
import { getEarliestRelevantDate, type BalanceEnvelope, type EnvelopeBalanceInputs } from './envelope-balance'

type Db = Pick<PrismaClient, 'envelope' | 'envelopeTransfer' | 'expenseTransaction' | 'incomeTransaction' | 'household'>

type AllocationRow = {
  id: string
  frequency: Frequency
  balanceSince: Date
  allocationsSince: Date | null
  closedAt: Date | null
  allocationSource: AllocationSource
  allocationAmount: number | null
  fixedCostPlans: Array<{ amount: number; frequency: Frequency; startDate: Date; endDate: Date | null }>
}

export function toAllocationRule(row: Pick<AllocationRow, 'allocationSource' | 'allocationAmount' | 'fixedCostPlans'>): AllocationRule {
  switch (row.allocationSource) {
    case 'FIXED':
      return { kind: 'fixed', amount: row.allocationAmount ?? 0 }
    case 'PLANS':
      return { kind: 'plans', plans: row.fixedCostPlans }
    default:
      return { kind: 'none' }
  }
}

export function toAllocationEnvelope(row: AllocationRow): AllocationEnvelope {
  return {
    frequency: row.frequency,
    balanceSince: row.balanceSince,
    allocationsSince: row.allocationsSince,
    closedAt: row.closedAt,
    rule: toAllocationRule(row),
  }
}

/**
 * Bucht alle faelligen, noch nicht gebuchten Zuteilungen des Haushalts bis
 * einschliesslich `today` (ADR-0005, Regel 2: ein Einstieg). Muss vor jedem
 * Saldo-Abruf laufen. Vor Aenderungen an der Planung (Regel 1) ruft es
 * `envelope-planning.ts` auf.
 *
 * Parallele Requests sind unkritisch: Der Unique-Index auf
 * `(toEnvelopeId, allocationPeriodStart)` und `skipDuplicates` verhindern
 * doppelte Zeilen.
 *
 * @returns Anzahl neu gebuchter Zuteilungen.
 */
export async function ensureAllocations(householdId: string, today: Date = new Date(), db: Db = prisma): Promise<number> {
  // Erst die gebuchten Zeilen, dann die Umschlaege: Schliessen loescht Zeilen ab
  // dem Stichtag und setzt `closedAt` in einer Transaktion. In dieser Reihenfolge
  // sieht ein paralleler Abruf die alten Zeilen oder schon `closedAt` und legt
  // nichts an. Umgekehrt saehe er den Umschlag offen, die Zeilen aber geloescht,
  // und buchte sie neu.
  const booked = await db.envelopeTransfer.findMany({
    where: { householdId, allocationPeriodStart: { not: null } },
    select: { toEnvelopeId: true, allocationPeriodStart: true },
  })
  const envelopes = await db.envelope.findMany({
    where: { householdId, allocationSource: { not: 'NONE' } },
    select: {
      id: true,
      frequency: true,
      balanceSince: true,
      allocationsSince: true,
      closedAt: true,
      allocationSource: true,
      allocationAmount: true,
      fixedCostPlans: { select: { amount: true, frequency: true, startDate: true, endDate: true } },
    },
  })
  if (envelopes.length === 0) return 0

  const { ledgerSince } = await db.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true } })
  const bookedByEnvelope = new Map<string, Date[]>()
  for (const row of booked) {
    if (!row.toEnvelopeId || !row.allocationPeriodStart) continue
    const list = bookedByEnvelope.get(row.toEnvelopeId) ?? []
    list.push(row.allocationPeriodStart)
    bookedByEnvelope.set(row.toEnvelopeId, list)
  }

  const data = envelopes.flatMap((envelope) =>
    listDueAllocations(toAllocationEnvelope(envelope), today, bookedByEnvelope.get(envelope.id) ?? []).map((due) => ({
      householdId,
      fromEnvelopeId: null,
      toEnvelopeId: envelope.id,
      amount: due.amount,
      date: getAllocationBookingDate(due.periodStart, ledgerSince),
      allocationPeriodStart: due.periodStart,
    })),
  )
  if (data.length === 0) return 0

  const result = await db.envelopeTransfer.createMany({ data, skipDuplicates: true })
  return result.count
}

/** Prisma-Select fuer alle Felder, die die Saldo-Berechnung braucht. */
export const envelopeBalanceSelect = {
  id: true,
  balanceSince: true,
  closedAt: true,
  carryoverToEnvelopeId: true,
} as const

/**
 * Laedt Ausgaben, Einnahmen und Umbuchungen ab dem fruehesten relevanten
 * Datum (Startpunkt eines Umschlags oder von "Zu verteilen").
 */
export async function loadEnvelopeBalanceInputs(
  householdId: string,
  envelopes: BalanceEnvelope[],
  ledgerSince: Date | null,
  db: Db = prisma,
): Promise<EnvelopeBalanceInputs> {
  const earliest = getEarliestRelevantDate(envelopes, ledgerSince)
  if (!earliest) return { expenses: [], incomes: [], transfers: [] }

  // Ab Mitternacht, damit auch Buchungen mit Uhrzeit vor 12:00 am Starttag
  // mitkommen; das genaue Fenster filtert `computeEnvelopeBalances`.
  const from = new Date(earliest)
  from.setHours(0, 0, 0, 0)

  const [expenses, incomes, transfers] = await Promise.all([
    db.expenseTransaction.findMany({
      where: { householdId, date: { gte: from }, deletedAt: null },
      select: { envelopeId: true, amount: true, date: true },
    }),
    db.incomeTransaction.findMany({
      where: { householdId, date: { gte: from }, deletedAt: null },
      select: { envelopeId: true, amount: true, date: true },
    }),
    db.envelopeTransfer.findMany({
      where: { householdId, date: { gte: from } },
      select: { fromEnvelopeId: true, toEnvelopeId: true, amount: true, date: true, allocationPeriodStart: true },
    }),
  ])
  return { expenses, incomes, transfers }
}
