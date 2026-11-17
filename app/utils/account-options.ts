/**
 * Konten (ADR-0006): Anzeige der Kontoarten und die Rechnung der
 * Einfuehrungs-Vorschau, getrennt von der Seite, damit sie testbar ist.
 */
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
    default:
      return error?.data?.statusMessage || error?.statusMessage || error?.message || 'Unbekannter Fehler.'
  }
}
