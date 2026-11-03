/**
 * Rechenkern fuer Umschlaege (ADR-0005, issue #154).
 *
 * Reine Funktionen ohne DB-Zugriff; die Anbindung liegt in `envelope-store.ts`.
 *
 * Zuteilungen werden in ADR-0005 gebucht statt berechnet: Sobald eine Periode
 * begonnen hat, entsteht eine Zeile mit dem Betrag, den die Regel *zu diesem
 * Zeitpunkt* ergibt. Dieses Modul beantwortet dafuer drei Fragen:
 *   - Welcher Betrag gehoert zu einer Periode? (`computeAllocationAmount`)
 *   - Welche Perioden sind faellig, aber noch nicht gebucht? (`listDueAllocations`)
 *   - Was wird bis Monatsende noch zugeteilt? (`listReservedAllocations`)
 * Dazu die Bewertung nach Saldo statt nach Periodenausgaben.
 *
 * Perioden folgen dem bestehenden Raster (`startOfPeriod`/`addPeriod`), alle
 * Vergleiche laufen tagesgenau ueber `dayKey` (12:00 Serverzeit).
 */
import type { Frequency } from '@prisma/client'
import { addPeriod, dayKey, startOfPeriod, type PeriodSeverity } from './period'

export type AllocationPlan = {
  amount: number
  frequency: Frequency
  startDate: Date
  endDate: Date | null
}

/**
 * Zuteilungsregel eines Umschlags. Keine Versionen: Vergangene Perioden sind
 * gebucht, eine geaenderte Regel wirkt ab der naechsten noch nicht gebuchten.
 */
export type AllocationRule =
  | { kind: 'fixed'; amount: number }
  | { kind: 'plans'; plans: AllocationPlan[] }
  | { kind: 'none' }

export type AllocationEnvelope = {
  frequency: Frequency
  /** Immer ein Periodenbeginn der Frequenz; ab hier wird zugeteilt. */
  balanceSince: Date
  /**
   * Erste Periode einer Regel, die erst nachtraeglich dazukam. Fuer Perioden
   * ohne Regel gibt es keine Zeile, die sie als erledigt markiert; ohne diese
   * Grenze wuerden sie mit der neuen Regel rueckwirkend gebucht.
   */
  allocationsSince?: Date | null
  /** Stichtag (exklusiv), ab dem nicht mehr zugeteilt wird. */
  closedAt: Date | null
  rule: AllocationRule
}

export type PeriodAllocation = {
  /** Periodenbeginn — zugleich Buchungsdatum und `allocationPeriodStart`. */
  periodStart: Date
  amount: number
}

// Mittlere Wochen pro Jahr: Ein Wochenplan kostet uebers Jahr 365,25/7-mal
// seinen Betrag, nicht 52-mal — sonst fehlte jaehrlich gut ein Tag.
const WEEKS_PER_YEAR = 365.25 / 7

const PERIODS_PER_YEAR: Record<Exclude<Frequency, 'ONCE'>, number> = {
  WEEKLY: WEEKS_PER_YEAR,
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
}

/**
 * Perioden mit Start in `[from, to)`, begrenzt auf `[balanceSince, closedAt)`
 * und `allocationsSince`.
 * ONCE hat genau eine Periode zu `balanceSince`.
 */
function listPeriodStarts(envelope: AllocationEnvelope, fromKey: number, toKey: number): Date[] {
  const sinceKey = dayKey(envelope.balanceSince)
  const closedKey = envelope.closedAt ? dayKey(envelope.closedAt) : Number.POSITIVE_INFINITY
  const lower = Math.max(fromKey, sinceKey, envelope.allocationsSince ? dayKey(envelope.allocationsSince) : sinceKey)
  const upper = Math.min(toKey, closedKey)

  if (envelope.frequency === 'ONCE') {
    return sinceKey >= lower && sinceKey < upper ? [new Date(sinceKey)] : []
  }

  const starts: Date[] = []
  let cursor = startOfPeriod(envelope.balanceSince, envelope.frequency)
  while (cursor.getTime() < upper) {
    const next = addPeriod(cursor, envelope.frequency)
    // Schutz gegen Endlosschleifen bei kaputten Daten, wie in listAllocations.
    if (!(next.getTime() > cursor.getTime())) break
    if (cursor.getTime() >= lower) starts.push(cursor)
    cursor = next
  }
  return starts
}

/**
 * Beitrag eines Plans zur Periode `[periodStart, periodEnd)`.
 *
 * Wiederkehrende Plaene werden auf die Frequenz des Umschlags umgelegt (600 €
 * jaehrlich → 50 € je Monat), damit das Geld bei Faelligkeit angespart ist.
 * Gerundet wird kumulativ ueber die aktiven Perioden des Plans: Beitrag der
 * k-ten Periode = round(k · exakt) − round((k − 1) · exakt). So summiert sich
 * ein Jahr auf den Cent genau, statt 12 × 33,33 € fuer 400 € zuzuteilen.
 *
 * Aktiv ist ein Plan in jeder Periode, die sein Intervall
 * `[startDate, endDate]` beruehrt; gezaehlt wird ab der ersten solchen Periode
 * des Umschlags (nicht vor `balanceSince`).
 */
function planContribution(
  plan: AllocationPlan,
  envelope: AllocationEnvelope & { frequency: Exclude<Frequency, 'ONCE'> },
  periodStart: Date,
  periodEnd: Date,
): number {
  const planStartKey = dayKey(plan.startDate)
  const planEndKey = plan.endDate ? dayKey(plan.endDate) : Number.POSITIVE_INFINITY
  const startKey = periodStart.getTime()
  const endKey = periodEnd.getTime()

  // ONCE: voller Betrag in der Periode, in die sein Datum faellt.
  if (plan.frequency === 'ONCE') {
    return planStartKey >= startKey && planStartKey < endKey ? plan.amount : 0
  }

  if (planStartKey >= endKey || planEndKey < startKey) return 0

  const exact = (plan.amount * PERIODS_PER_YEAR[plan.frequency]) / PERIODS_PER_YEAR[envelope.frequency]
  const firstActive = Math.max(dayKey(startOfPeriod(plan.startDate, envelope.frequency)), dayKey(envelope.balanceSince))
  const index = listPeriodStarts(envelope, firstActive, endKey).length
  return Math.round(index * exact) - Math.round((index - 1) * exact)
}

/**
 * Betrag, den die Regel fuer die Periode ab `periodStart` ergibt. Gebucht wird
 * er erst, wenn die Periode begonnen hat — danach aendert eine neue Regel ihn
 * nicht mehr.
 */
export function computeAllocationAmount(envelope: AllocationEnvelope, periodStart: Date): number {
  const { rule } = envelope
  if (rule.kind === 'none') return 0
  if (rule.kind === 'fixed') return rule.amount

  // Ein ONCE-Umschlag hat kein Raster, auf das sich wiederkehrende Plaene
  // umlegen liessen; aus Plaenen zuteilen koennen nur periodische Umschlaege.
  if (envelope.frequency === 'ONCE') return 0
  const periodic = envelope as AllocationEnvelope & { frequency: Exclude<Frequency, 'ONCE'> }
  const start = new Date(dayKey(periodStart))
  const end = addPeriod(start, periodic.frequency)
  return rule.plans.reduce((total, plan) => total + planContribution(plan, periodic, start, end), 0)
}

/**
 * Perioden, die bis einschliesslich `today` begonnen haben, aber noch keine
 * gebuchte Zuteilung haben — die Arbeitsliste fuer `ensureAllocations`.
 * `bookedPeriodStarts` sind die `allocationPeriodStart`s bereits gebuchter
 * Zeilen; auch ausgelassene (Betrag 0) zaehlen als gebucht.
 *
 * Ein Umschlag ohne Regel bekommt keine Zeilen. Ein Betrag von 0 aus der
 * Regel wird dagegen gebucht, damit die Periode als erledigt gilt und eine
 * spaetere Regelaenderung sie nicht nachtraeglich fuellt.
 */
export function listDueAllocations(
  envelope: AllocationEnvelope,
  today: Date,
  bookedPeriodStarts: Iterable<Date>,
): PeriodAllocation[] {
  if (envelope.rule.kind === 'none') return []
  const booked = new Set([...bookedPeriodStarts].map(dayKey))
  return listPeriodStarts(envelope, Number.NEGATIVE_INFINITY, dayKey(today) + 1)
    .filter((start) => !booked.has(start.getTime()))
    .map((periodStart) => ({ periodStart, amount: computeAllocationAmount(envelope, periodStart) }))
}

/**
 * Buchungsdatum einer Zuteilung: der Periodenbeginn, aber nicht vor dem
 * Startpunkt von "Zu verteilen". Sonst bekaeme der Umschlag das Geld, ohne
 * dass "Zu verteilen" belastet wird — und zwar im Normalfall: Ein am 15.
 * angelegter Monatsumschlag startet am 1. und laege vor `ledgerSince`.
 * `allocationPeriodStart` bleibt der Periodenbeginn.
 *
 * Liegt `ledgerSince` noch in der Zukunft, gilt das nicht: Die Zuteilung
 * zaehlt zum Bestand am Stichtag, und mit einem kuenftigen Datum waere sie
 * bis dahin nicht im Saldo.
 */
export function getAllocationBookingDate(periodStart: Date, ledgerSince: Date, today: Date): Date {
  const ledgerKey = dayKey(ledgerSince)
  if (dayKey(periodStart) >= ledgerKey || ledgerKey > dayKey(today)) return periodStart
  return new Date(ledgerKey)
}

/** Erster Tag des Folgemonats von `today` — Ende des Vormerk-Horizonts (exklusiv). */
export function getReservationHorizon(today: Date): Date {
  const value = new Date(dayKey(today))
  value.setMonth(value.getMonth() + 1, 1)
  return value
}

/**
 * Vorgemerkte Zuteilungen: Perioden, die nach `today` und vor Ende des
 * Kalendermonats beginnen. Das Geld steht noch in "Zu verteilen", ist aber
 * nicht mehr frei — sonst wuerde das Geld fuer KW 2–4 eines Monats in KW 1
 * anderweitig verteilt. Eine Wochenzuteilung gehoert zum Monat ihres Montags.
 *
 * Relevant nur fuer Frequenzen kuerzer als ein Monat; ein Monatsumschlag ist
 * am 1. gebucht und hat im laufenden Monat nichts mehr vorgemerkt.
 */
export function listReservedAllocations(envelope: AllocationEnvelope, today: Date): PeriodAllocation[] {
  if (envelope.rule.kind === 'none') return []
  return listPeriodStarts(envelope, dayKey(today) + 1, getReservationHorizon(today).getTime())
    .map((periodStart) => ({ periodStart, amount: computeAllocationAmount(envelope, periodStart) }))
}

export type PeriodAvailability = {
  /** Aktueller Saldo + Ausgaben der Periode. */
  available: number
  spent: number
  /** Ausgaben ÷ verfuegbar in %; null, wenn nichts verfuegbar war. */
  percentUsed: number | null
}

/**
 * Wie viel in dieser Periode zur Verfuegung stand und wie viel davon
 * ausgegeben ist. Vom aktuellen Saldo aus gerechnet, damit auch Gutschriften
 * und Umbuchungen in der Periode zaehlen: Die Luecke `available − spent` ist
 * immer genau der Saldo, Balken und Zahl koennen sich nicht widersprechen.
 */
export function computePeriodAvailability(input: { balance: number; spent: number }): PeriodAvailability {
  const available = input.balance + input.spent
  return {
    available,
    spent: input.spent,
    percentUsed: available > 0 ? (input.spent / available) * 100 : null,
  }
}

// Wie viel weniger Geld als Zeit uebrig sein darf, bevor ein Umschlag gelb wird.
// Ohne Spielraum waere jeder Grosseinkauf am Periodenanfang ein Alarm, denn
// Ausgaben kommen in grossen Einzelbetraegen und nicht gleichmaessig.
const PACE_WARNING_FACTOR = 0.5

/** Anteil der Periode, der noch vor uns liegt (0–1). */
export function computeRemainingTimeShare(periodStart: Date, periodEnd: Date, now: Date): number {
  const share = (periodEnd.getTime() - now.getTime()) / (periodEnd.getTime() - periodStart.getTime())
  return Math.min(1, Math.max(0, share))
}

/**
 * Bewertung nach Saldo (ADR-0005): Ueberzogen ist ein Umschlag erst mit
 * negativem Saldo, nicht schon, wenn die Ausgaben einer Periode die Zuteilung
 * uebersteigen.
 *
 * Gelb heisst: prozentual weniger als halb so viel Geld uebrig wie Zeit. Das
 * beschreibt den Stand und sagt nichts voraus, die Schwelle sinkt zum
 * Periodenende von selbst auf null. `remainingTimeShare` ist null, wo der
 * Vergleich nichts aussagt (ohne Periode oder ausserhalb der laufenden
 * Ausgaben: Die Miete geht am 1. ab, "Wohnen" waere sonst den ganzen Monat gelb).
 */
export function classifyEnvelopeSeverity(input: {
  balance: number
  available: number | null
  remainingTimeShare: number | null
}): PeriodSeverity {
  if (input.balance < 0) return 'over'
  if (input.available === null || input.available <= 0 || input.remainingTimeShare === null) return 'ok'
  return input.balance / input.available < input.remainingTimeShare * PACE_WARNING_FACTOR ? 'warning' : 'ok'
}
