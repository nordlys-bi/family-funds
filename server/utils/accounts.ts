/**
 * Konten verwalten (ADR-0006, issue #189): Einfuehrung, spaeter angelegte
 * Konten, Aendern, Schliessen, Loeschen. Eine Funktion je Aktion mit
 * `{ db = prisma }`, wie `envelope-planning.ts`; die Endpoints pruefen nur
 * Auth und parsen.
 *
 * Grundregel: Σ Umschlaege + Zu verteilen = Σ Konten. Darum
 * - starten die ersten Konten alle am neuen Stichtag (`ledgerSince`), und der
 *   Startwert von "Zu verteilen" ergibt sich aus ihnen (`envelope-balance.ts`);
 * - braucht jede Buchung ab dem Stichtag ein Konto, auch die, die es beim
 *   Einfuehren schon gibt;
 * - startet kein Konto vor dem Stichtag.
 */
import { createError } from 'h3'
import type { AccountType, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { dayKey } from './period'
import { ensureAllocations, envelopeBalanceSelect, loadEnvelopeBalanceInputs } from './envelope-store'
import { computeEnvelopeBalances, computeUnassignedBalance, sumEnvelopeBalances } from './envelope-balance'
import { computeAccountBalances } from './account-balance'
import { parseSignedMoney } from './envelope-lifecycle'

type AccountsDb = Pick<
  PrismaClient,
  | 'account'
  | 'accountTransfer'
  | 'accountAdjustment'
  | 'envelopeAccount'
  | 'householdMember'
  | 'household'
  | 'envelope'
  | 'envelopeTransfer'
  | 'expenseTransaction'
  | 'incomeTransaction'
  | '$transaction'
>

export type AccountsContext = {
  db?: AccountsDb
  today?: Date
}

export const accountTypes = ['CHECKING', 'CASH', 'SAVINGS'] as const satisfies readonly AccountType[]

export function parseAccountType(value: unknown): AccountType {
  if (typeof value === 'string' && (accountTypes as readonly string[]).includes(value)) return value as AccountType
  throw createError({ statusCode: 400, statusMessage: `Type must be one of ${accountTypes.join(', ')}.` })
}

/** Body eines Kontos (Anlegen, Einfuehrung); `undefined`-Felder fehlen. */
export function parseAccountValues(body: unknown): AccountValues {
  const raw = (body ?? {}) as { name?: unknown; type?: unknown; openingBalance?: unknown }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required.' })
  return {
    name,
    type: parseAccountType(raw.type),
    openingBalance: raw.openingBalance === undefined || raw.openingBalance === null || raw.openingBalance === ''
      ? 0
      : parseSignedMoney(raw.openingBalance, 'Opening balance'),
  }
}

/**
 * `accountIds`/`primaryAccountId` aus dem Body eines Umschlags; `undefined`,
 * wenn der Body die Bindung nicht anfasst.
 */
export function parseEnvelopeAccounts(body: unknown): { accountIds: string[]; primaryAccountId: string | null } | undefined {
  const raw = (body ?? {}) as { accountIds?: unknown; primaryAccountId?: unknown }
  if (raw.accountIds === undefined) return undefined
  if (!Array.isArray(raw.accountIds) || raw.accountIds.some((id) => typeof id !== 'string' || !id)) {
    throw createError({ statusCode: 400, statusMessage: 'accountIds must be a list of account ids.' })
  }
  const primary = raw.primaryAccountId
  if (primary !== undefined && primary !== null && typeof primary !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'primaryAccountId must be an account id.' })
  }
  return { accountIds: raw.accountIds as string[], primaryAccountId: primary || null }
}

export type AccountValues = {
  name: string
  type: AccountType
  /** Kontostand zu Beginn des Starttags, darf negativ sein (Dispo). */
  openingBalance: number
}

export type AccountChanges = {
  name?: string
  type?: AccountType
  openingBalance?: number
  /** `null` = wieder oeffnen. */
  closedAt?: Date | null
}

/** Beginn des Tages, fuer `gte`-Filter auf Buchungen mit Uhrzeit. */
function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function dayBefore(date: Date) {
  const value = new Date(date)
  value.setDate(value.getDate() - 1)
  value.setHours(12, 0, 0, 0)
  return value
}

async function hasAccounts(db: AccountsDb, householdId: string) {
  return (await db.account.count({ where: { householdId } })) > 0
}

async function findAccount(db: AccountsDb, householdId: string, id: string) {
  const account = await db.account.findFirst({ where: { id, householdId } })
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  return account
}

/** Aktive Ausgaben und Einnahmen ohne Konto ab `date`. */
async function countBookingsWithoutAccount(db: AccountsDb, householdId: string, date: Date) {
  const where = { householdId, accountId: null, deletedAt: null, date: { gte: startOfDay(date) } }
  const [expenses, incomes] = await Promise.all([db.expenseTransaction.count({ where }), db.incomeTransaction.count({ where })])
  return expenses + incomes
}

function assertNotInFuture(date: Date, today: Date, fieldName: string) {
  if (dayKey(date) > dayKey(today)) {
    throw createError({ statusCode: 400, statusMessage: `${fieldName} must not be in the future.` })
  }
}

/**
 * Konten mit Saldo zum Tag `today`. Ohne Konten eine leere Liste; dann zeigt
 * die Oberflaeche die Einfuehrung an.
 */
export async function listAccounts(householdId: string, { db = prisma, today = new Date() }: AccountsContext = {}) {
  const accounts = await db.account.findMany({ where: { householdId }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] })
  if (accounts.length === 0) return []

  const from = startOfDay(accounts.reduce((earliest, account) => (account.startDate < earliest ? account.startDate : earliest), accounts[0]!.startDate))
  // Ohne `deletedAt`-Filter, weil "hat Buchungen" auch geloeschte zaehlt:
  // Der Fremdschluessel haelt sie fest, Loeschen ginge sonst schief.
  const select = { accountId: true, amount: true, date: true, deletedAt: true } as const
  const where = { householdId, accountId: { not: null }, date: { gte: from } }
  const [expenses, incomes, transfers, adjustments] = await Promise.all([
    db.expenseTransaction.findMany({ where, select }),
    db.incomeTransaction.findMany({ where, select }),
    db.accountTransfer.findMany({ where: { householdId }, select: { fromAccountId: true, toAccountId: true, amount: true, date: true } }),
    db.accountAdjustment.findMany({ where: { householdId }, select: { accountId: true, amount: true, date: true } }),
  ])
  const active = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter((row) => row.deletedAt === null)
  const balances = computeAccountBalances(
    accounts,
    { expenses: active(expenses), incomes: active(incomes), accountTransfers: transfers, adjustments },
    today,
  )
  const withBookings = new Set([
    ...[...expenses, ...incomes, ...adjustments].map((row) => row.accountId),
    ...transfers.flatMap((transfer) => [transfer.fromAccountId, transfer.toAccountId]),
  ])
  // Letzter Abgleich (#192), auch einer ohne Differenz: bis dahin stimmt das Konto.
  const lastReconciled = new Map<string, Date>()
  for (const adjustment of adjustments) {
    const known = lastReconciled.get(adjustment.accountId)
    if (!known || adjustment.date > known) lastReconciled.set(adjustment.accountId, adjustment.date)
  }

  return accounts.map((account) => ({
    ...account,
    balance: balances.get(account.id) ?? 0,
    hasBookings: withBookings.has(account.id),
    lastReconciledAt: lastReconciled.get(account.id) ?? null,
  }))
}

/**
 * Vorschau der Einfuehrung zum Tag `date`: was "Zu verteilen" bisher am Ende
 * des Vortags zeigt, und was zu dem Zeitpunkt schon in Umschlaegen steckt.
 * Der neue Startwert ist dann Σ eingegebene Kontostaende − `envelopesBefore`;
 * die Oberflaeche rechnet ihn beim Tippen selbst aus.
 */
export async function previewIntroduction(householdId: string, date: Date, { db = prisma, today = new Date() }: AccountsContext = {}) {
  await ensureAllocations(householdId, today, db)
  const household = await db.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true, openingBalance: true } })
  const envelopes = await db.envelope.findMany({ where: { householdId }, select: envelopeBalanceSelect })
  const inputs = await loadEnvelopeBalanceInputs(householdId, envelopes, household.ledgerSince, db)
  const before = dayBefore(date)
  const balances = computeEnvelopeBalances(envelopes, inputs, before)

  return {
    date,
    ledgerSince: household.ledgerSince,
    envelopesBefore: sumEnvelopeBalances(envelopes, balances, household.ledgerSince, before),
    // Liegt der neue Stichtag auf dem bisherigen, ist das der Anfangsbestand.
    unassignedBefore: computeUnassignedBalance(household, envelopes, balances, inputs, before),
    bookingsWithoutAccount: await countBookingsWithoutAccount(db, householdId, date),
  }
}

/**
 * Fuehrt Konten ein (ADR-0006, "Stichtag und Migration"): Alle Konten starten
 * an `date`, `ledgerSince` wandert dorthin, "Zu verteilen" startet abgeleitet
 * neu. Buchungen ohne Konto ab `date` bekommen das Konto mit dem Index
 * `existingBookingsAccount`; ohne Angabe lehnt der Server ab, statt sie still
 * aus der Rechnung fallen zu lassen.
 *
 * Erst nachbuchen, dann aendern (ADR-0005): Das Buchungsdatum einer Zuteilung
 * haengt vom Stichtag ab.
 */
export async function introduceAccounts(
  householdId: string,
  date: Date,
  accounts: AccountValues[],
  existingBookingsAccount: number | null,
  { db = prisma, today = new Date() }: AccountsContext = {},
) {
  if (accounts.length === 0) throw createError({ statusCode: 400, statusMessage: 'At least one account is required.' })
  if (existingBookingsAccount !== null && !accounts[existingBookingsAccount]) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown account for existing bookings.' })
  }
  assertNotInFuture(date, today, 'Date')
  if (await hasAccounts(db, householdId)) {
    throw createError({ statusCode: 409, statusMessage: 'Accounts are already introduced.', data: { reason: 'introduced' } })
  }

  await ensureAllocations(householdId, today, db)
  const { ledgerSince } = await db.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true } })
  // Frueher hiesse: Zuteilungen und Umbuchungen, die "Zu verteilen" schon
  // abgezogen hat, zaehlten nachtraeglich zum Bestand der Umschlaege.
  if (dayKey(date) < dayKey(ledgerSince)) {
    throw createError({ statusCode: 400, statusMessage: 'Date is before the start of "Zu verteilen".', data: { reason: 'before-ledger' } })
  }
  const withoutAccount = await countBookingsWithoutAccount(db, householdId, date)
  if (withoutAccount > 0 && existingBookingsAccount === null) {
    throw createError({
      statusCode: 409,
      statusMessage: 'There are bookings without an account from this date on.',
      data: { reason: 'bookings-without-account', count: withoutAccount },
    })
  }

  return db.$transaction(async (tx) => {
    await tx.household.update({ where: { id: householdId }, data: { ledgerSince: date } })
    const created = []
    for (const account of accounts) {
      created.push(await tx.account.create({ data: { householdId, ...account, startDate: date } }))
    }
    if (withoutAccount > 0 && existingBookingsAccount !== null) {
      const data = { accountId: created[existingBookingsAccount]!.id }
      const where = { householdId, accountId: null, deletedAt: null, date: { gte: startOfDay(date) } }
      await tx.expenseTransaction.updateMany({ where, data })
      await tx.incomeTransaction.updateMany({ where, data })
    }
    return created
  })
}

/**
 * Ein spaeteres Konto (das Sparschwein im Februar). Sein Anfangsbestand ist
 * Geld, von dem der Haushalt bisher nichts wusste, und wird an `startDate`
 * "Zu verteilen" gutgeschrieben (`envelope-balance.ts`). Erst nach der
 * Einfuehrung: Davor gaebe es keinen abgeleiteten Startwert, zu dem es passt.
 */
export async function createAccount(
  householdId: string,
  values: AccountValues & { startDate: Date },
  { db = prisma, today = new Date() }: AccountsContext = {},
) {
  if (!(await hasAccounts(db, householdId))) {
    throw createError({ statusCode: 409, statusMessage: 'Introduce accounts first.', data: { reason: 'not-introduced' } })
  }
  assertNotInFuture(values.startDate, today, 'Start date')
  const { ledgerSince } = await db.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true } })
  if (dayKey(values.startDate) < dayKey(ledgerSince)) {
    throw createError({ statusCode: 400, statusMessage: 'Start date is before the start of "Zu verteilen".', data: { reason: 'before-ledger' } })
  }
  return db.account.create({ data: { householdId, ...values } })
}

/**
 * Name, Art und Anfangsbestand. Ein geaenderter Anfangsbestand ist die
 * Korrektur einer Eingabe und verschiebt "Zu verteilen" mit. Das Startdatum
 * bleibt fest: Es entscheidet, welche Buchungen zum Konto zaehlen.
 *
 * Schliessen (`closedAt`, Stichtag exklusiv) geht nur, wenn ab dann keine
 * Buchung mehr auf dem Konto liegt, und nicht vor dem Start.
 */
export async function updateAccount(householdId: string, id: string, changes: AccountChanges, { db = prisma }: AccountsContext = {}) {
  const account = await findAccount(db, householdId, id)
  if (changes.closedAt) {
    if (dayKey(changes.closedAt) <= dayKey(account.startDate)) {
      throw createError({ statusCode: 400, statusMessage: 'Closing date must be after the start of the account.', data: { reason: 'close-before-start' } })
    }
    const since = { gte: startOfDay(changes.closedAt) }
    const where = { householdId, accountId: id, deletedAt: null, date: since }
    const later = (await db.expenseTransaction.count({ where }))
      + (await db.incomeTransaction.count({ where }))
      + (await db.accountTransfer.count({ where: { householdId, OR: [{ fromAccountId: id }, { toAccountId: id }], date: since } }))
      + (await db.accountAdjustment.count({ where: { householdId, accountId: id, date: since } }))
    if (later > 0) {
      throw createError({ statusCode: 409, statusMessage: 'The account has bookings from this date on.', data: { reason: 'bookings-after-close', count: later } })
    }
  }
  return db.account.update({
    where: { id },
    data: {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.type !== undefined ? { type: changes.type } : {}),
      ...(changes.openingBalance !== undefined ? { openingBalance: changes.openingBalance } : {}),
      ...(changes.closedAt !== undefined ? { closedAt: changes.closedAt } : {}),
    },
  })
}

/**
 * Prueft eine Bindung, ohne zu schreiben. Die Endpoints rufen das vor dem
 * Anlegen oder Aendern des Umschlags auf, damit eine ungueltige Bindung nicht
 * einen halb gespeicherten Umschlag hinterlaesst.
 */
export async function checkEnvelopeAccounts(
  householdId: string,
  accountIds: string[],
  primaryAccountId: string | null,
  { db = prisma }: AccountsContext = {},
) {
  const ids = [...new Set(accountIds)]
  const known = ids.length === 0 ? 0 : await db.account.count({ where: { householdId, id: { in: ids } } })
  if (known !== ids.length) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  if (primaryAccountId !== null && !ids.includes(primaryAccountId)) {
    throw createError({ statusCode: 400, statusMessage: 'The primary account must be bound.', data: { reason: 'primary-not-bound' } })
  }
  return { ids, primary: primaryAccountId ?? ids[0] ?? null }
}

/**
 * Bindet einen Umschlag an Konten (ADR-0006, issue #190). Die Bindung ist nur
 * ein Eingabefilter: Sie entscheidet, was "Bezahlt mit" anbietet, nicht was
 * gebucht werden darf. Darum duerfen auch geschlossene Konten gebunden
 * bleiben; die Erfassung blendet sie ohnehin aus.
 *
 * Leere Liste = keine Bindung. Ohne Hauptkonto wird das erste Konto der
 * Liste eines, denn vorausgewaehlt wird immer genau eins.
 */
export async function setEnvelopeAccounts(
  householdId: string,
  envelopeId: string,
  accountIds: string[],
  primaryAccountId: string | null,
  { db = prisma }: AccountsContext = {},
) {
  const envelope = await db.envelope.findFirst({ where: { id: envelopeId, householdId }, select: { id: true } })
  if (!envelope) throw createError({ statusCode: 404, statusMessage: 'Envelope not found.' })
  const { ids, primary } = await checkEnvelopeAccounts(householdId, accountIds, primaryAccountId, { db })

  return db.$transaction(async (tx) => {
    await tx.envelopeAccount.deleteMany({ where: { envelopeId } })
    if (ids.length > 0) await tx.envelopeAccount.createMany({ data: ids.map((accountId) => ({ envelopeId, accountId })) })
    await tx.envelope.update({ where: { id: envelopeId }, data: { primaryAccountId: primary } })
    return { accountIds: ids, primaryAccountId: primary }
  })
}

/**
 * Standardkonto eines Mitglieds (ADR-0006): vorausgewaehlt bei Umschlaegen
 * ohne Bindung. Jeder stellt nur sein eigenes ein; `null` = keins.
 */
export async function setDefaultAccount(
  householdId: string,
  userId: string,
  accountId: string | null,
  { db = prisma, today = new Date() }: AccountsContext = {},
) {
  if (accountId !== null) {
    const account = await findAccount(db, householdId, accountId)
    if (account.closedAt && dayKey(account.closedAt) <= dayKey(today)) {
      throw createError({ statusCode: 400, statusMessage: 'The account is closed.', data: { reason: 'closed' } })
    }
  }
  await db.householdMember.updateMany({ where: { householdId, userId }, data: { defaultAccountId: accountId } })
  return { defaultAccountId: accountId }
}

export type AccountHistoryEntry = {
  type: 'opening' | 'income' | 'expense' | 'transfer' | 'adjustment'
  /** Buchung oder Uebertrag; null beim Anfangsbestand. */
  id: string | null
  date: Date
  /** Wirkung auf den Saldo: + erhoeht, − senkt. */
  amount: number
  /** Beschreibung der Buchung oder Notiz des Uebertrags. */
  text: string | null
  envelopeName: string | null
  /** Gegenkonto eines Uebertrags. */
  counterpartId: string | null
  counterpartName: string | null
  userName: string | null
  /** Abgleich: der eingegebene Kontostand. */
  statedBalance: number | null
  /** Saldo nach dieser Bewegung. */
  balance: number
}

type PersonRef = { displayName: string | null; email: string } | null | undefined
const personName = (user: PersonRef) => (user ? user.displayName || user.email : null)

/**
 * Kontoverlauf (issue #191): Anfangsbestand, Einnahmen, Ausgaben,
 * Uebertraege und Abgleiche (#192) mit dem Saldo danach, neueste zuerst.
 * Gleiche Regeln wie `computeAccountBalances`: nur aktive Buchungen ab dem
 * Start des Kontos. Am selben Tag zaehlt die Reihenfolge der Erfassung,
 * Abgleiche kommen zuletzt.
 */
export async function loadAccountHistory(householdId: string, accountId: string, { db = prisma, today = new Date() }: AccountsContext = {}) {
  const account = await findAccount(db, householdId, accountId)
  const from = startOfDay(account.startDate)
  const bookingSelect = {
    id: true, amount: true, date: true, description: true, createdAt: true,
    envelope: { select: { name: true } },
    user: { select: { displayName: true, email: true } },
  } as const
  const bookingWhere = { householdId, accountId, deletedAt: null, date: { gte: from } }
  const [expenses, incomes, transfers, adjustments] = await Promise.all([
    db.expenseTransaction.findMany({ where: bookingWhere, select: bookingSelect }),
    db.incomeTransaction.findMany({ where: bookingWhere, select: bookingSelect }),
    db.accountTransfer.findMany({
      where: { householdId, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }], date: { gte: from } },
      include: {
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
        user: { select: { displayName: true, email: true } },
      },
    }),
    db.accountAdjustment.findMany({
      where: { householdId, accountId, date: { gte: from } },
      include: { user: { select: { displayName: true, email: true } } },
    }),
  ])

  type Movement = Omit<AccountHistoryEntry, 'balance'> & { createdAt: Date }
  const booking = (type: 'income' | 'expense', sign: 1 | -1) => (row: (typeof expenses)[number]): Movement => ({
    type, id: row.id, date: row.date, amount: sign * row.amount, text: row.description,
    envelopeName: row.envelope?.name ?? null, counterpartId: null, counterpartName: null,
    userName: personName(row.user), statedBalance: null, createdAt: row.createdAt,
  })
  const movements: Movement[] = [
    ...incomes.map(booking('income', 1)),
    ...expenses.map(booking('expense', -1)),
    ...transfers.map((row): Movement => {
      const outgoing = row.fromAccountId === accountId
      return {
        type: 'transfer', id: row.id, date: row.date, amount: outgoing ? -row.amount : row.amount, text: row.note,
        envelopeName: null,
        counterpartId: outgoing ? row.toAccountId : row.fromAccountId,
        counterpartName: (outgoing ? row.toAccount?.name : row.fromAccount?.name) ?? null,
        userName: personName(row.user), statedBalance: null, createdAt: row.createdAt,
      }
    }),
    ...adjustments.map((row): Movement => ({
      type: 'adjustment', id: row.id, date: row.date, amount: row.amount, text: row.note,
      envelopeName: null, counterpartId: null, counterpartName: null,
      userName: personName(row.user), statedBalance: row.statedBalance, createdAt: row.createdAt,
    })),
    // Ein Abgleich gilt fuer das Ende seines Tages: am selben Tag nach allen
    // Buchungen, auch nach spaeter nacherfassten.
  ].sort((left, right) =>
    dayKey(left.date) - dayKey(right.date)
    || Number(left.type === 'adjustment') - Number(right.type === 'adjustment')
    || left.createdAt.getTime() - right.createdAt.getTime())

  let balance = account.openingBalance
  const entries: AccountHistoryEntry[] = [{
    type: 'opening', id: null, date: account.startDate, amount: account.openingBalance, text: null,
    envelopeName: null, counterpartId: null, counterpartName: null, userName: null, statedBalance: null, balance,
  }]
  for (const { createdAt: _createdAt, ...movement } of movements) {
    balance += movement.amount
    entries.push({ ...movement, balance })
  }
  const todayKey = dayKey(today)
  const current = [...entries].reverse().find((entry) => dayKey(entry.date) <= todayKey)?.balance ?? 0
  return { account: { ...account, balance: current }, entries: entries.reverse() }
}

/**
 * Nur ein Konto ohne Buchungen, auch ohne geloeschte (der Fremdschluessel
 * haelt sie fest). Das letzte Konto bleibt: Ohne Konten rechnete der
 * Haushalt wieder mit dem alten, laengst ueberholten Anfangsbestand.
 */
export async function deleteAccount(householdId: string, id: string, { db = prisma }: AccountsContext = {}) {
  await findAccount(db, householdId, id)
  const where = { householdId, accountId: id }
  const bookings = (await db.expenseTransaction.count({ where }))
    + (await db.incomeTransaction.count({ where }))
    + (await db.accountTransfer.count({ where: { householdId, OR: [{ fromAccountId: id }, { toAccountId: id }] } }))
    + (await db.accountAdjustment.count({ where }))
  if (bookings > 0) {
    throw createError({ statusCode: 409, statusMessage: 'The account has bookings.', data: { reason: 'has-bookings' } })
  }
  if ((await db.account.count({ where: { householdId } })) <= 1) {
    throw createError({ statusCode: 409, statusMessage: 'The last account cannot be deleted.', data: { reason: 'last-account' } })
  }
  await db.account.delete({ where: { id } })
}
