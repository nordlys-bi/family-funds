/**
 * Salden reeller Konten (ADR-0006). Reine Funktionen wie
 * `envelope-balance.ts`; nie gespeichert, sondern eine Summe:
 *
 *   saldo(k, t) = k.openingBalance, sobald t ≥ k.startDate
 *               + Σ Einnahmen (accountId = k) − Σ Ausgaben (accountId = k)
 *               + Σ Uebertraege nach k − Σ Uebertraege von k
 *               + Σ Korrekturen auf k
 *               jeweils mit Datum in [k.startDate, t]
 *
 * Ein Uebertrag (#191) aendert zwei Kontosalden und keinen Umschlag; die
 * Summe aller Konten bleibt gleich, solange beide Konten am Tag laufen (das
 * prueft `account-transfers.ts`). Eine Korrektur (#192) trifft das Konto und
 * "Zu verteilen" (`envelope-balance.ts`) um denselben Betrag. Vergleiche
 * laufen tagesgenau ueber `dayKey`.
 */
import { dayKey } from './period'

export type BalanceAccount = {
  id: string
  /** Kontostand zu Beginn von `startDate`, vor den Buchungen des Tages. */
  openingBalance: number
  startDate: Date
}

/** Ausgabe oder Einnahme; `accountId` null = vor den Konten erfasst. */
export type AccountBooking = {
  accountId?: string | null
  amount: number
  date: Date
}

/** Kontouebertrag; hart geloescht, also nie gefiltert. */
export type AccountTransferMovement = {
  fromAccountId: string
  toAccountId: string
  amount: number
  date: Date
}

/** Korrektur aus einem Abgleich; hart geloescht, also nie gefiltert. */
export type AccountAdjustmentMovement = {
  accountId: string
  amount: number
  date: Date
}

export type AccountBalanceInputs = {
  /** Bereits auf `deletedAt: null` gefiltert. */
  expenses: AccountBooking[]
  /** Bereits auf `deletedAt: null` gefiltert. */
  incomes: AccountBooking[]
  /** Eigener Name, damit Umschlag-Eingaben (`transfers`) nicht still passen. */
  accountTransfers?: AccountTransferMovement[]
  adjustments?: AccountAdjustmentMovement[]
}

/**
 * Salden aller uebergebenen Konten zum Zeitpunkt `at`. Buchungen ausserhalb
 * von `[startDate, at]` werden verworfen; vor seinem Start hat ein Konto
 * Saldo 0, auch nicht den Anfangsbestand.
 */
export function computeAccountBalances(
  accounts: BalanceAccount[],
  inputs: AccountBalanceInputs,
  at: Date = new Date(),
): Map<string, number> {
  const atKey = dayKey(at)
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const balances = new Map(accounts.map((account) => [account.id, dayKey(account.startDate) <= atKey ? account.openingBalance : 0]))
  const add = (booking: AccountBooking, sign: 1 | -1) => {
    const account = booking.accountId ? byId.get(booking.accountId) : undefined
    if (!account) return
    const key = dayKey(booking.date)
    if (key < dayKey(account.startDate) || key > atKey) return
    balances.set(account.id, balances.get(account.id)! + sign * booking.amount)
  }
  for (const income of inputs.incomes) add(income, 1)
  for (const expense of inputs.expenses) add(expense, -1)
  for (const transfer of inputs.accountTransfers ?? []) {
    add({ accountId: transfer.toAccountId, amount: transfer.amount, date: transfer.date }, 1)
    add({ accountId: transfer.fromAccountId, amount: transfer.amount, date: transfer.date }, -1)
  }
  for (const adjustment of inputs.adjustments ?? []) add(adjustment, 1)
  return balances
}
