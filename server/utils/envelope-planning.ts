/**
 * Planung (ADR-0005): alles, was der OWNER fuer kuenftiges Geld festlegt. Eine
 * Funktion je Fachaktion; die Endpoints pruefen Auth und parsen den Body.
 *
 * Regel 1, "erst nachbuchen, dann aendern", liegt hier und nicht beim
 * Aufrufer. Jede Aktion, die eine Zuteilung betreffen kann, bucht zuerst nach,
 * ohne Bedingung: Das aendert keinen Saldo, weil der naechste Abruf dieselben
 * Zeilen anlegen wuerde. Zu selten nachzubuchen gaebe dagegen einer begonnenen
 * Periode still den neuen Betrag.
 *
 * Nachbuchen und Aendern laufen bewusst nicht in einer Transaktion: Scheitert
 * die Aenderung, bleibt nur, was der naechste Abruf ohnehin gebucht haette. Eine
 * neue Periode um Mitternacht und parallele Aenderungen fing sie auch nicht ab.
 */
import { createError } from 'h3'
import type { AllocationSource, EnvelopeGroup, Frequency, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { addPeriod, dayKey, startOfPeriod } from './period'
import { ensureAllocations } from './envelope-store'
import { assertAllocationRule, assertCanCloseEnvelope, planRunsPast, wouldCreateCarryoverCycle } from './envelope-lifecycle'
import type { PlanningKind } from './planning'

type PlanningDb = Pick<
  PrismaClient,
  'envelope' | 'envelopeTransfer' | 'expenseTransaction' | 'incomeTransaction' | 'fixedCostPlan' | 'incomePlan' | 'household' | '$transaction'
>

export type PlanningContext = {
  db?: PlanningDb
  today?: Date
}

export type PlanValues = {
  name: string
  amount: number
  frequency: Frequency
  startDate: Date
  endDate: Date | null
  /** null = kein Umschlag. */
  envelopeId: string | null
}

export type EnvelopeChanges = {
  name?: string
  group?: EnvelopeGroup
  targetAmount?: number | null
  targetDate?: Date | null
  allocationSource?: AllocationSource
  allocationAmount?: number | null
}

export type LedgerStartChanges = {
  ledgerSince?: Date
  openingBalance?: number
}

type PlanRun = Pick<PlanValues, 'envelopeId' | 'frequency' | 'startDate' | 'endDate'>

/**
 * Der Umschlag gehoert zum Haushalt, und der Plan laeuft nicht ueber dessen
 * Stichtag hinaus: dieselbe Regel wie beim Schliessen, nur aus der anderen
 * Richtung.
 */
async function assertPlanFitsEnvelope(db: PlanningDb, householdId: string, plan: PlanRun) {
  if (!plan.envelopeId) return
  const envelope = await db.envelope.findFirst({ where: { id: plan.envelopeId, householdId }, select: { closedAt: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  if (envelope.closedAt && planRunsPast(plan, envelope.closedAt)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Plan must not run past the closing date of its envelope.',
      data: { reason: 'active-plans' },
    })
  }
}

/**
 * Prueft nur, wenn sich Umschlag oder Laufzeit wirklich aendern. Das Formular
 * schickt immer alle Felder mit; ein bestehender Altfall soll eine Umbenennung
 * oder einen neuen Betrag nicht blockieren.
 */
async function assertPlanChangeFitsEnvelope(db: PlanningDb, householdId: string, existing: PlanRun, changes: Partial<PlanValues>) {
  const next: PlanRun = {
    envelopeId: changes.envelopeId === undefined ? existing.envelopeId : changes.envelopeId,
    frequency: changes.frequency ?? existing.frequency,
    startDate: changes.startDate ?? existing.startDate,
    endDate: changes.endDate === undefined ? existing.endDate : changes.endDate,
  }
  const endKey = (plan: PlanRun) => (plan.endDate ? dayKey(plan.endDate) : null)
  const unchanged = next.envelopeId === existing.envelopeId
    && next.frequency === existing.frequency
    && dayKey(next.startDate) === dayKey(existing.startDate)
    && endKey(next) === endKey(existing)
  if (!unchanged) await assertPlanFitsEnvelope(db, householdId, next)
}

/** Einnahmen-Plaene fliessen in keine Zuteilung ein und buchen deshalb nicht nach. */
export async function createPlan(householdId: string, kind: PlanningKind, values: PlanValues, { db = prisma, today = new Date() }: PlanningContext = {}) {
  await assertPlanFitsEnvelope(db, householdId, values)
  if (kind === 'incomePlan') return db.incomePlan.create({ data: { householdId, ...values } })

  await ensureAllocations(householdId, today, db)
  return db.fixedCostPlan.create({ data: { householdId, ...values } })
}

/** `undefined` in `changes` = Feld bleibt, wie es ist. */
export async function updatePlan(
  householdId: string,
  kind: PlanningKind,
  planId: string,
  changes: Partial<PlanValues>,
  { db = prisma, today = new Date() }: PlanningContext = {},
) {
  const where = { id: planId, householdId }
  if (kind === 'incomePlan') {
    const existing = await db.incomePlan.findFirst({ where })
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Income plan not found.' })
    await assertPlanChangeFitsEnvelope(db, householdId, existing, changes)
    return db.incomePlan.update({ where: { id: planId }, data: changes })
  }

  const existing = await db.fixedCostPlan.findFirst({ where })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Fixed cost plan not found.' })
  await assertPlanChangeFitsEnvelope(db, householdId, existing, changes)
  await ensureAllocations(householdId, today, db)
  return db.fixedCostPlan.update({ where: { id: planId }, data: changes })
}

export async function deleteFixedCostPlan(householdId: string, planId: string, { db = prisma, today = new Date() }: PlanningContext = {}) {
  const existing = await db.fixedCostPlan.findFirst({ where: { id: planId, householdId }, select: { id: true } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Fixed cost plan not found.' })

  await ensureAllocations(householdId, today, db)
  await db.fixedCostPlan.delete({ where: { id: planId } })
}

/**
 * Aendert Name, Gruppe, Sparziel und Zuteilungsregel in einem Schreibvorgang.
 * Nachgebucht wird nur, wenn die Regel Teil der Aenderung ist; Name, Gruppe und
 * Sparziel betreffen keine Zuteilung. Frequenz und Startpunkt sind unveraenderlich.
 */
export async function updateEnvelope(householdId: string, envelopeId: string, changes: EnvelopeChanges, { db = prisma, today = new Date() }: PlanningContext = {}) {
  const existing = await db.envelope.findFirst({ where: { id: envelopeId, householdId } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })

  const { allocationSource: newSource, allocationAmount: newAmount, ...data } = changes
  if (newSource === undefined && newAmount === undefined) {
    return db.envelope.update({ where: { id: envelopeId }, data })
  }

  const allocationSource = newSource ?? existing.allocationSource
  const allocationAmount = allocationSource !== 'FIXED' ? null : newAmount === undefined ? existing.allocationAmount : newAmount
  assertAllocationRule(existing.frequency, allocationSource, allocationAmount)
  // Ohne Regel gibt es keine Zeilen, die vergangene Perioden als erledigt
  // markieren. Die neue Regel startet deshalb wie jede Aenderung mit der
  // naechsten Periode, statt rueckwirkend nachzubuchen. ONCE hat kein Raster
  // und bekommt seine eine Zuteilung.
  const startsNextPeriod = existing.allocationSource === 'NONE' && allocationSource !== 'NONE' && existing.frequency !== 'ONCE'

  await ensureAllocations(householdId, today, db)
  return db.envelope.update({
    where: { id: envelopeId },
    data: {
      ...data,
      allocationSource,
      allocationAmount,
      ...(startsNextPeriod ? { allocationsSince: addPeriod(startOfPeriod(today, existing.frequency), existing.frequency) } : {}),
    },
  })
}

const closeSelect = {
  id: true,
  householdId: true,
  frequency: true,
  balanceSince: true,
  closedAt: true,
} as const

/**
 * Schliesst den Umschlag zum Stichtag in `targetId` (null = "Zu verteilen").
 * Zuteilungen ab dem Stichtag werden entfernt: Die Periode gehoert nicht mehr
 * dem Umschlag. Andere Buchungen ab dem Stichtag und Plaene darueber hinaus
 * blockieren (409), sie muessen erst umgehaengt oder beendet werden.
 */
export async function closeEnvelope(
  householdId: string,
  envelopeId: string,
  closedAt: Date,
  targetId: string | null,
  { db = prisma, today = new Date() }: PlanningContext = {},
) {
  const [envelope, target] = await Promise.all([
    db.envelope.findFirst({ where: { id: envelopeId, householdId }, select: closeSelect }),
    targetId ? db.envelope.findFirst({ where: { id: targetId, householdId }, select: closeSelect }) : null,
  ])
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  assertCanCloseEnvelope(envelope, target, closedAt, targetId !== null)
  if (targetId) {
    const envelopes = await db.envelope.findMany({ where: { householdId }, select: { id: true, carryoverToEnvelopeId: true } })
    if (wouldCreateCarryoverCycle(envelopeId, targetId, envelopes)) {
      throw createError({ statusCode: 400, statusMessage: 'Target envelope already flows into this envelope.', data: { reason: 'carryover-cycle' } })
    }
  }

  const planSelect = { frequency: true, startDate: true, endDate: true } as const
  const [fixedCostPlans, incomePlans] = await Promise.all([
    db.fixedCostPlan.findMany({ where: { envelopeId }, select: planSelect }),
    db.incomePlan.findMany({ where: { envelopeId }, select: planSelect }),
  ])
  if ([...fixedCostPlans, ...incomePlans].some((plan) => planRunsPast(plan, closedAt))) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Envelope still has plans running past the closing date. Move or end them first.',
      data: { reason: 'active-plans' },
    })
  }

  const closedFrom = new Date(closedAt)
  closedFrom.setHours(0, 0, 0, 0)
  const [laterExpenses, laterIncomes, laterTransfers] = await Promise.all([
    db.expenseTransaction.count({ where: { envelopeId, deletedAt: null, date: { gte: closedFrom } } }),
    db.incomeTransaction.count({ where: { envelopeId, deletedAt: null, date: { gte: closedFrom } } }),
    db.envelopeTransfer.count({
      where: { allocationPeriodStart: null, date: { gte: closedFrom }, OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }] },
    }),
  ])
  if (laterExpenses + laterIncomes + laterTransfers > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Envelope has bookings on or after the closing date. Move them to another envelope first.',
    })
  }

  await ensureAllocations(householdId, today, db)
  return db.$transaction(async (tx) => {
    await tx.envelopeTransfer.deleteMany({
      where: { toEnvelopeId: envelopeId, allocationPeriodStart: { gte: closedFrom } },
    })
    return tx.envelope.update({
      where: { id: envelopeId },
      data: { closedAt, carryoverToEnvelopeId: targetId },
    })
  })
}

/**
 * Startpunkt und Anfangsbestand von "Zu verteilen". Das Buchungsdatum einer
 * Zuteilung haengt vom Startpunkt ab, deshalb bucht auch seine Aenderung zuerst
 * nach. Sonst hinge "Zu verteilen" davon ab, ob vorher jemand abgerufen hat.
 */
export async function setLedgerStart(householdId: string, changes: LedgerStartChanges, { db = prisma, today = new Date() }: PlanningContext = {}) {
  if (changes.ledgerSince !== undefined) await ensureAllocations(householdId, today, db)
  return db.household.update({
    where: { id: householdId },
    data: changes,
    select: { ledgerSince: true, openingBalance: true },
  })
}
