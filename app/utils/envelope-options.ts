/**
 * Umschlag-Auswahl beim Buchen (ADR-0005): Ein Umschlag nimmt Buchungen nur
 * in `[balanceSince, closedAt)` an. Die Auswahl wird deshalb nach
 * Buchungsdatum gefiltert — der Server prueft dasselbe, hier geht es nur
 * darum, gar nicht erst eine Option anzubieten, die mit 400 endet.
 */
export type EnvelopeGroup = 'RUNNING' | 'FIXED' | 'RESERVE' | 'SAVINGS' | 'PERSONAL'

export type EnvelopeOption = {
  id: string
  name: string
  group: EnvelopeGroup
  balanceSince: string | Date
  closedAt?: string | Date | null
}

const GROUP_ORDER: EnvelopeGroup[] = ['RUNNING', 'FIXED', 'RESERVE', 'SAVINGS', 'PERSONAL']

function dayKey(value: string | Date) {
  // Reines 'YYYY-MM-DD' (Formular-Format) als LOKALEN Tag lesen — `new Date`
  // interpretiert es sonst als UTC-Mitternacht und westlich von UTC als Vortag.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

/** Nimmt der Umschlag am Tag `date` Buchungen an? Tagesgenau, Stichtag exklusiv. */
export function isEnvelopeBookableOn(
  envelope: Pick<EnvelopeOption, 'balanceSince' | 'closedAt'>,
  date: string | Date,
): boolean {
  const key = dayKey(date)
  return key >= dayKey(envelope.balanceSince) && (!envelope.closedAt || key < dayKey(envelope.closedAt))
}

/** Die am Buchungsdatum buchbaren Umschlaege; ohne Datum alle offenen. */
export function envelopesBookableOn<T extends EnvelopeOption>(envelopes: T[], date: string | Date | null | undefined): T[] {
  if (!date) return envelopes.filter((envelope) => !envelope.closedAt)
  return envelopes.filter((envelope) => isEnvelopeBookableOn(envelope, date))
}

/** Reihenfolge fuer Dropdowns: nach Gruppe, darin nach Name. */
export function sortEnvelopes<T extends EnvelopeOption>(envelopes: T[]): T[] {
  return [...envelopes].sort((left, right) =>
    GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) || left.name.localeCompare(right.name, 'de'),
  )
}
