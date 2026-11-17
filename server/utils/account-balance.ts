/**
 * Salden reeller Konten (ADR-0006). Reine Funktionen wie
 * `envelope-balance.ts`; nie gespeichert, sondern eine Summe:
 *
 *   saldo(k, t) = k.openingBalance, sobald t ≥ k.startDate
 *               + Σ Einnahmen (accountId = k) − Σ Ausgaben (accountId = k)
 *               jeweils mit Datum in [k.startDate, t]
 *
 * Kontouebertraege (#191) und Korrekturen (#192) kommen hier dazu, sobald es
 * sie gibt. Vergleiche laufen tagesgenau ueber `dayKey`.
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

export type AccountBalanceInputs = {
  /** Bereits auf `deletedAt: null` gefiltert. */
  expenses: AccountBooking[]
  /** Bereits auf `deletedAt: null` gefiltert. */
  incomes: AccountBooking[]
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
  return balances
}
