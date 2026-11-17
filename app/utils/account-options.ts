/**
 * Konten (ADR-0006): Anzeige der Kontoarten, die Rechnung der
 * Einfuehrungs-Vorschau und die Auswahl "Bezahlt mit" (issue #190), getrennt
 * von den Komponenten, damit sie testbar sind.
 */
import { dayKey } from './envelope-options'

export type AccountType = 'CHECKING' | 'CASH' | 'SAVINGS'

export const ACCOUNT_TYPES: Array<{ value: AccountType; label: string; icon: string }> = [
  { value: 'CHECKING', label: 'Girokonto', icon: 'pi pi-credit-card' },
  { value: 'CASH', label: 'Bargeld', icon: 'pi pi-money-bill' },
  { value: 'SAVINGS', label: 'Sparkonto', icon: 'pi pi-building' },
]

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPES.find((item) => item.value === type)?.label ?? type
}

export function accountTypeIcon(type: AccountType): string {
  return ACCOUNT_TYPES.find((item) => item.value === type)?.icon ?? 'pi pi-wallet'
}

export type IntroductionPreview = {
  /** "Zu verteilen" am Ende des Vortags, in Cent. */
  unassignedBefore: number
  /** Summe der Umschlaege am Ende des Vortags, in Cent. */
  envelopesBefore: number
}

/**
 * Neuer Startwert von "Zu verteilen" aus den eingegebenen Kontostaenden (in
 * Euro, wie MoneyInput sie liefert) und die Differenz zum bisherigen Wert:
 * das Geld, das bisher nicht erfasst war (negativ: fehlt).
 */
export function introductionTotals(preview: IntroductionPreview, balancesInEuro: Array<number | null>) {
  const accounts = balancesInEuro.reduce<number>((sum, value) => sum + Math.round((value ?? 0) * 100), 0)
  const unassigned = accounts - preview.envelopesBefore
  return { accounts, unassigned, difference: unassigned - preview.unassignedBefore }
}

/** Konto, wie `GET .../accounts` es liefert (Datumswerte als ISO-String). */
export type PaidWithAccount = {
  id: string
  name: string
  type: AccountType
  startDate: string | Date
  closedAt?: string | Date | null
}

/** Kontobindung eines Umschlags; leere `accountIds` = keine Bindung. */
export type AccountBinding = {
  accountIds: string[]
  primaryAccountId: string | null
}

/** Wert des Eintrags "Anderes Konto…"; nie ein echtes Konto. */
export const OTHER_ACCOUNT = '__other__'

/** Startet vor oder am Tag und ist an dem Tag nicht geschlossen (exklusiv). */
export function isAccountBookableOn(account: PaidWithAccount, date: string | Date): boolean {
  const key = dayKey(date)
  return key >= dayKey(account.startDate) && (!account.closedAt || key < dayKey(account.closedAt))
}

function isBound(binding: AccountBinding | null | undefined): binding is AccountBinding {
  return Boolean(binding && binding.accountIds.length > 0)
}

/**
 * Optionen fuer "Bezahlt mit" (ADR-0006): Mit Bindung nur die gebundenen
 * Konten und darunter "Anderes Konto…", das alle uebrigen erreichbar macht
 * (`showAll`). Ohne Bindung alle am Tag buchbaren Konten. Ein schon gewaehltes
 * Konto bleibt sichtbar, damit das Feld nicht leer wirkt.
 */
export function paidWithOptions(input: {
  accounts: PaidWithAccount[]
  date: string | Date | null
  binding?: AccountBinding | null
  showAll?: boolean
  selectedId?: string | null
}): Array<{ label: string; value: string; type?: AccountType }> {
  const bookable = input.accounts.filter((account) => !input.date || isAccountBookableOn(account, input.date))
  const toOption = (account: PaidWithAccount) => ({ label: account.name, value: account.id, type: account.type })
  if (!isBound(input.binding) || input.showAll) {
    const shown = bookable.some((account) => account.id === input.selectedId)
      ? bookable
      : [...bookable, ...input.accounts.filter((account) => account.id === input.selectedId)]
    return shown.map(toOption)
  }
  const bound = input.binding.accountIds
  const shown = input.accounts.filter((account) =>
    account.id === input.selectedId || (bound.includes(account.id) && bookable.includes(account)),
  )
  const others = bookable.some((account) => !shown.includes(account))
  return [...shown.map(toOption), ...(others ? [{ label: 'Anderes Konto…', value: OTHER_ACCOUNT }] : [])]
}

/**
 * Vorauswahl (ADR-0006): das Hauptkonto des Umschlags, sonst ein anderes
 * gebundenes, ohne Bindung das Standardkonto des Mitglieds. Gibt es am Tag
 * nur ein Konto, ist es das. Sonst bleibt das Feld leer und muss gewaehlt
 * werden, statt still ein beliebiges Konto zu nehmen.
 */
export function defaultPaidWith(input: {
  accounts: PaidWithAccount[]
  date: string | Date | null
  binding?: AccountBinding | null
  memberDefaultId?: string | null
}): string | null {
  const bookable = input.accounts.filter((account) => !input.date || isAccountBookableOn(account, input.date))
  const has = (id: string | null | undefined) => Boolean(id && bookable.some((account) => account.id === id))
  if (isBound(input.binding)) {
    if (has(input.binding.primaryAccountId)) return input.binding.primaryAccountId
    const bound = input.binding.accountIds.find((id) => has(id))
    if (bound) return bound
  } else if (has(input.memberDefaultId)) {
    return input.memberDefaultId!
  }
  return bookable.length === 1 ? bookable[0]!.id : null
}

/** Deutsche Meldung zu bekannten Fehlergruenden des Servers. */
export function accountErrorText(error: any): string {
  const data = error?.data?.data ?? error?.data
  switch (data?.reason) {
    case 'bookings-without-account':
      return `Ab diesem Tag gibt es schon ${data.count} Buchung(en) ohne Konto. Wähle aus, zu welchem Konto sie gehören.`
    case 'before-ledger':
      return 'Der Tag liegt vor dem bisherigen Start von „Zu verteilen“.'
    case 'introduced':
      return 'Die Konten sind bereits eingeführt.'
    case 'not-introduced':
      return 'Führe zuerst die Konten ein.'
    case 'close-before-start':
      return 'Ein Konto lässt sich frühestens am Tag nach seinem Start schließen.'
    case 'bookings-after-close':
      return `Das Konto hat ab diesem Tag noch ${data.count} Buchung(en).`
    case 'has-bookings':
      return 'Das Konto hat Buchungen. Schließe es, statt es zu löschen.'
    case 'last-account':
      return 'Das letzte Konto lässt sich nicht löschen.'
    case 'account-required':
      return 'Bitte wähle, womit bezahlt wurde.'
    case 'before-account-start':
      return 'Das Konto gab es an diesem Tag noch nicht.'
    case 'primary-not-bound':
      return 'Das Hauptkonto muss zu den gebundenen Konten gehören.'
    case 'closed':
      return 'Das Konto ist geschlossen.'
    case 'same-account':
      return 'Von- und Nach-Konto müssen sich unterscheiden.'
    case 'account-closed':
      return 'Das Konto ist an diesem Tag geschlossen.'
    default:
      return error?.data?.statusMessage || error?.statusMessage || error?.message || 'Unbekannter Fehler.'
  }
}
