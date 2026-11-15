/**
 * Ausgaben und Einnahmen schreiben (issue #181): was eine Buchung gueltig
 * macht, an einer Stelle statt kopiert ueber POST, PATCH, DELETE und Restore.
 * Eine Funktion je Aktion mit `kind`; die Endpoints pruefen Auth und parsen
 * den Body, wie bei `envelope-planning.ts`.
 *
 * Umbuchungen gehoeren bewusst nicht hierher. Sie teilen mit Buchungen nur die
 * Laufzeit-Pruefung des Umschlags (`assertEnvelopeAcceptsBooking`).
 *
 * Stufe 2 (reelle Konten) aendert dann nur diese Datei: Jede Buchung nennt
 * ein Konto, gleich auf welchem Weg sie entsteht.
 */
import { createError } from 'h3'
import type { PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { assertEnvelopeAcceptsBooking, assertEnvelopeOpenOn } from './envelope-lifecycle'
import { dayKey } from './period'

export const transactionKinds = ['expense', 'income'] as const
export type TransactionKind = (typeof transactionKinds)[number]

export function assertTransactionKind(value: unknown): TransactionKind {
  if (typeof value === 'string' && transactionKinds.includes(value as TransactionKind)) {
    return value as TransactionKind
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid transaction kind.',
  })
}

type TransactionDb = Pick<PrismaClient, 'envelope' | 'expenseTransaction' | 'incomeTransaction' | 'fixedCostPlan' | 'incomePlan'>

export type TransactionContext = {
  db?: TransactionDb
  now?: Date
}

export type TransactionValues = {
  amount: number
  date: Date
  description: string | null
  /** null = "Zu verteilen". */
  envelopeId: string | null
  /** Fixkosten- bzw. Einnahmenplan, je nach `kind`. */
  planId: string | null
}

/** `undefined` = nicht geaendert, bei `envelopeId` ist `null` "Zu verteilen". */
export type TransactionChanges = {
  amount?: number
  date?: Date
  description?: string | null
  envelopeId?: string | null
}

const notFoundMessage: Record<TransactionKind, string> = {
  expense: 'Expense transaction not found.',
  income: 'Income transaction not found.',
}

/**
 * Beide Tabellen haben bis auf den Plan-FK dieselben Spalten. Prisma-Delegates
 * zweier Modelle lassen sich als Union nicht aufrufen, deshalb als Ausgaben-
 * Delegate getypt; der Plan-FK wird ueber `planData` passend gesetzt.
 */
function rows(db: TransactionDb, kind: TransactionKind) {
  return (kind === 'expense' ? db.expenseTransaction : db.incomeTransaction) as unknown as TransactionDb['expenseTransaction']
}

function planData(kind: TransactionKind, planId: string | null) {
  return (kind === 'expense' ? { fixedCostPlanId: planId } : { incomePlanId: planId }) as { fixedCostPlanId: string | null }
}

async function findPlan(db: TransactionDb, householdId: string, kind: TransactionKind, planId: string) {
  const query = { where: { id: planId, householdId }, select: { id: true, envelopeId: true } }
  const plan = kind === 'expense' ? await db.fixedCostPlan.findFirst(query) : await db.incomePlan.findFirst(query)
  if (!plan) {
    throw createError({
      statusCode: 404,
      statusMessage: kind === 'expense' ? 'Fixed cost plan not found.' : 'Income plan not found.',
    })
  }
  return plan
}

/**
 * Der Umschlag gehoert zum Haushalt und nimmt am Buchungstag Buchungen an.
 * `null` = "Zu verteilen", immer erlaubt: Vor `ledgerSince` zaehlt so eine
 * Buchung nur in den Auswertungen (ADR-0005), das Nacherfassen alter Belege
 * bleibt damit moeglich.
 */
async function assertBookingEnvelope(db: TransactionDb, householdId: string, envelopeId: string | null, date: Date) {
  if (!envelopeId) return
  const envelope = await db.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { closedAt: true, balanceSince: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  assertEnvelopeAcceptsBooking(envelope, date)
}

/**
 * Soft-Delete (issue #58): PATCH und DELETE wirken nur auf aktive Zeilen.
 * Geloeschte kommen nur ueber Restore zurueck, damit das UI nicht still eine
 * "geloeschte" Buchung mit neuen Werten ueberschreibt.
 */
async function findActive(db: TransactionDb, householdId: string, kind: TransactionKind, id: string) {
  const existing = await rows(db, kind).findFirst({ where: { id, householdId, deletedAt: null } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: notFoundMessage[kind] })
  return existing
}

export async function createTransaction(
  householdId: string,
  userId: string,
  kind: TransactionKind,
  values: TransactionValues,
  { db = prisma }: TransactionContext = {},
) {
  let envelopeId = values.envelopeId

  // Issue #59 (hart gekoppelt): Hat der Plan einen Umschlag, bekommt die
  // Buchung immer dessen Umschlag, auch wenn der Body einen anderen nennt
  // (Miete → Wohnen, Kindergeld → Kinder). Abweichungen gehen danach per PATCH.
  if (values.planId) {
    const plan = await findPlan(db, householdId, kind, values.planId)
    if (plan.envelopeId) envelopeId = plan.envelopeId
  }

  // ADR-0005: keine Buchungen ab dem Stichtag eines geschlossenen Umschlags
  // und keine vor seinem Startpunkt.
  await assertBookingEnvelope(db, householdId, envelopeId, values.date)

  return rows(db, kind).create({
    data: {
      householdId,
      userId,
      amount: values.amount,
      description: values.description,
      date: values.date,
      envelopeId,
      ...planData(kind, values.planId),
    },
  })
}

/**
 * Umschlag und Datum nur pruefen, wenn sich eines davon aendert: Altbestand
 * vor dem Startpunkt eines Umschlags muss sich weiter korrigieren lassen
 * (Betrag, Beschreibung), und das Formular schickt das Datum immer mit.
 */
function changesBooking(existing: { envelopeId: string | null; date: Date }, changes: TransactionChanges) {
  return (changes.envelopeId !== undefined && changes.envelopeId !== existing.envelopeId)
    || (changes.date !== undefined && dayKey(changes.date) !== dayKey(existing.date))
}

export async function updateTransaction(
  householdId: string,
  kind: TransactionKind,
  id: string,
  changes: TransactionChanges,
  { db = prisma }: TransactionContext = {},
) {
  const existing = await findActive(db, householdId, kind, id)

  // ADR-0005: gegen den resultierenden Umschlag und das resultierende Datum.
  // Auch ein reines Datums-Update darf eine Buchung nicht hinter den Stichtag
  // eines geschlossenen Umschlags schieben.
  if (changesBooking(existing, changes)) {
    await assertBookingEnvelope(
      db,
      householdId,
      changes.envelopeId === undefined ? existing.envelopeId : changes.envelopeId,
      changes.date ?? existing.date,
    )
  }

  return rows(db, kind).update({
    where: { id },
    data: {
      ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.date !== undefined ? { date: changes.date } : {}),
      ...(changes.envelopeId !== undefined ? { envelopeId: changes.envelopeId } : {}),
    },
  })
}

/**
 * Soft-Delete (issue #58), ohne spaeteres Hard-Delete: Die Zeile bleibt fuer
 * Verlauf und Restore. Eine schon geloeschte Zeile ist 404, die Liste zeigt
 * sie ohnehin nicht mehr.
 */
export async function deleteTransaction(
  householdId: string,
  kind: TransactionKind,
  id: string,
  { db = prisma, now = new Date() }: TransactionContext = {},
) {
  await findActive(db, householdId, kind, id)
  await rows(db, kind).update({ where: { id }, data: { deletedAt: now } })
}

/**
 * Idempotent: Eine aktive Zeile bleibt unveraendert (`alreadyActive`).
 *
 * ADR-0005: Wiederherstellen wirkt wie eine neue Buchung, deshalb gilt der
 * Stichtag des Umschlags; ab dann gehoert die Buchung zum Nachfolger. Der
 * Startpunkt zaehlt bewusst nicht: Die Buchung existierte schon, Altbestand
 * vor dem Start bliebe sonst fuer immer geloescht.
 */
export async function restoreTransaction(
  householdId: string,
  kind: TransactionKind,
  id: string,
  { db = prisma }: TransactionContext = {},
) {
  // Ohne `deletedAt`-Filter: gesucht ist gerade die geloeschte Zeile.
  const existing = await rows(db, kind).findFirst({ where: { id, householdId } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: notFoundMessage[kind] })
  if (existing.deletedAt === null) return { alreadyActive: true }

  if (existing.envelopeId) {
    const envelope = await db.envelope.findFirst({ where: { id: existing.envelopeId, householdId }, select: { closedAt: true } })
    if (envelope) assertEnvelopeOpenOn(envelope, existing.date)
  }

  await rows(db, kind).update({ where: { id }, data: { deletedAt: null } })
  return { alreadyActive: false }
}
