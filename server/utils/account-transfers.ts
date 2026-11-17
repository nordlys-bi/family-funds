/**
 * Kontouebertraege (ADR-0006, issue #191): Geld wechselt den Ort, nicht den
 * Zweck. Ein Uebertrag aendert zwei Kontosalden und keinen Umschlag, und er
 * zaehlt in keiner Auswertung, weil er in eigener Tabelle liegt.
 *
 * Die Invariante Σ Umschlaege + Zu verteilen = Σ Konten haelt, solange beide
 * Konten am Tag des Uebertrags laufen: Vor seinem Start oder ab seinem
 * Schliesstag zaehlt ein Konto die Bewegung nicht mit, die Gegenseite schon.
 * Das prueft `assertAccountsOpenOn` bei jedem Schreiben.
 *
 * Wie Umbuchungen zwischen Umschlaegen: eine Buchung fuer alle Mitglieder,
 * hart geloescht, die Seiten bleiben fest (fuer ein anderes Konto loeschen
 * und neu buchen).
 */
import { createError } from 'h3'
import type { PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { dayKey } from './period'

type TransfersDb = Pick<PrismaClient, 'account' | 'accountTransfer'>

export type AccountTransfersContext = { db?: TransfersDb }

export type AccountTransferValues = {
  fromAccountId: string
  toAccountId: string
  /** Cent, > 0. */
  amount: number
  date: Date
  note: string | null
}

export type AccountTransferChanges = Partial<Pick<AccountTransferValues, 'amount' | 'date' | 'note'>>

/** Beide Konten gehoeren zum Haushalt und laufen am Tag (Start ≤ Tag < Schliesstag). */
async function assertAccountsOpenOn(db: TransfersDb, householdId: string, ids: [string, string], date: Date) {
  if (ids[0] === ids[1]) {
    throw createError({ statusCode: 400, statusMessage: 'Source and target account must differ.', data: { reason: 'same-account' } })
  }
  const accounts = await db.account.findMany({ where: { householdId, id: { in: ids } }, select: { id: true, startDate: true, closedAt: true } })
  if (accounts.length !== 2) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  const key = dayKey(date)
  for (const account of accounts) {
    if (key < dayKey(account.startDate)) {
      throw createError({ statusCode: 400, statusMessage: 'Date is before the start of the account.', data: { reason: 'before-account-start' } })
    }
    if (account.closedAt && key >= dayKey(account.closedAt)) {
      throw createError({ statusCode: 400, statusMessage: 'Account is closed on this date.', data: { reason: 'account-closed' } })
    }
  }
}

export async function createAccountTransfer(
  householdId: string,
  userId: string,
  values: AccountTransferValues,
  { db = prisma }: AccountTransfersContext = {},
) {
  await assertAccountsOpenOn(db, householdId, [values.fromAccountId, values.toAccountId], values.date)
  return db.accountTransfer.create({ data: { householdId, userId, ...values } })
}

/** Betrag, Datum und Notiz; ein neues Datum muss fuer beide Konten passen. */
export async function updateAccountTransfer(
  householdId: string,
  id: string,
  changes: AccountTransferChanges,
  { db = prisma }: AccountTransfersContext = {},
) {
  const existing = await db.accountTransfer.findFirst({ where: { id, householdId } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Transfer not found.' })
  if (changes.date) await assertAccountsOpenOn(db, householdId, [existing.fromAccountId, existing.toAccountId], changes.date)
  return db.accountTransfer.update({
    where: { id },
    data: {
      ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
      ...(changes.date !== undefined ? { date: changes.date } : {}),
      ...(changes.note !== undefined ? { note: changes.note } : {}),
    },
  })
}

export async function deleteAccountTransfer(householdId: string, id: string, { db = prisma }: AccountTransfersContext = {}) {
  const existing = await db.accountTransfer.findFirst({ where: { id, householdId }, select: { id: true } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Transfer not found.' })
  await db.accountTransfer.delete({ where: { id } })
}
