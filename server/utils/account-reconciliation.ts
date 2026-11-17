/**
 * Abgleich (ADR-0006, issue #192): echten Kontostand eingeben, die Differenz
 * zum berechneten Stand als Korrektur (`AccountAdjustment`) ausbuchen. Sie
 * trifft das Konto und "Zu verteilen" um denselben Betrag, nie einen
 * Umschlag, und zaehlt in keiner Auswertung: Sie ist kein Geldfluss, sondern
 * das Eingestaendnis, dass irgendwo etwas nicht erfasst wurde.
 *
 * Ein Abgleich gilt fuer das Ende seines Tages und wird immer gespeichert,
 * auch ohne Differenz (amount 0 = "abgeglichen"). Der Betrag ist beim
 * Speichern berechnet und bleibt danach fest. Wer spaeter vor dem Tag
 * nacherfasst, gleicht erneut ab oder loescht die Korrektur.
 */
import { createError } from 'h3'
import type { PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { dayKey } from './period'
import { computeAccountBalances } from './account-balance'

type ReconciliationDb = Pick<PrismaClient, 'account' | 'accountAdjustment' | 'accountTransfer' | 'expenseTransaction' | 'incomeTransaction'>

export type ReconciliationContext = {
  db?: ReconciliationDb
  today?: Date
}

export type ReconciliationValues = {
  date: Date
  /** Echter Kontostand am Ende von `date`, in Cent, darf negativ sein. */
  statedBalance: number
  note: string | null
}

/** Berechneter Saldo eines Kontos am Ende von `at`, mit allen Korrekturen. */
export async function computedAccountBalance(householdId: string, accountId: string, at: Date, { db = prisma }: ReconciliationContext = {}) {
  const account = await db.account.findFirst({ where: { id: accountId, householdId } })
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  const select = { accountId: true, amount: true, date: true } as const
  const bookingWhere = { householdId, accountId, deletedAt: null }
  const [expenses, incomes, accountTransfers, adjustments] = await Promise.all([
    db.expenseTransaction.findMany({ where: bookingWhere, select }),
    db.incomeTransaction.findMany({ where: bookingWhere, select }),
    db.accountTransfer.findMany({
      where: { householdId, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
      select: { fromAccountId: true, toAccountId: true, amount: true, date: true },
    }),
    db.accountAdjustment.findMany({ where: { householdId, accountId }, select }),
  ])
  const balances = computeAccountBalances([account], { expenses, incomes, accountTransfers, adjustments }, at)
  return { account, balance: balances.get(account.id) ?? 0 }
}

/**
 * Gleicht ein Konto zum Ende von `values.date` ab und speichert die
 * Korrektur. Der Tag muss im Leben des Kontos liegen und darf nicht in der
 * Zukunft sein: Fuer morgen gibt es noch keinen echten Stand.
 */
export async function reconcileAccount(
  householdId: string,
  accountId: string,
  userId: string,
  values: ReconciliationValues,
  { db = prisma, today = new Date() }: ReconciliationContext = {},
) {
  const { account, balance } = await computedAccountBalance(householdId, accountId, values.date, { db })
  const key = dayKey(values.date)
  if (key > dayKey(today)) {
    throw createError({ statusCode: 400, statusMessage: 'Date must not be in the future.', data: { reason: 'future' } })
  }
  if (key < dayKey(account.startDate)) {
    throw createError({ statusCode: 400, statusMessage: 'Date is before the start of the account.', data: { reason: 'before-account-start' } })
  }
  if (account.closedAt && key >= dayKey(account.closedAt)) {
    throw createError({ statusCode: 400, statusMessage: 'Account is closed on this date.', data: { reason: 'account-closed' } })
  }
  return db.accountAdjustment.create({
    data: {
      householdId,
      accountId,
      userId,
      date: values.date,
      amount: values.statedBalance - balance,
      statedBalance: values.statedBalance,
      note: values.note,
    },
  })
}

/** Nimmt einen Abgleich zurueck; Konto und "Zu verteilen" aendern sich zurueck. */
export async function deleteAdjustment(householdId: string, id: string, { db = prisma }: ReconciliationContext = {}) {
  const existing = await db.accountAdjustment.findFirst({ where: { id, householdId }, select: { id: true } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Adjustment not found.' })
  await db.accountAdjustment.delete({ where: { id } })
}
