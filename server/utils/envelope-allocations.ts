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
 * Faelligkeit `index` eines wiederkehrenden Plans (0 = `startDate`). Monats-
 * basierte Plaene behalten ihren Tag; gibt es ihn im Zielmonat nicht (31. im
 * Februar), faellt die Faelligkeit auf den Monatsletzten.
 */
function planDueDate(plan: AllocationPlan, index: number): Date {
  const start = new Date(dayKey(plan.startDate))
  if (plan.frequency === 'WEEKLY') {
    start.setDate(start.getDate() + 7 * index)
    return start
  }
  const months = plan.frequency === 'MONTHLY' ? 1 : plan.frequency === 'QUARTERLY' ? 3 : 12
  const target = new Date(start.getFullYear(), start.getMonth() + months * index, 1, 12)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate()
  target.setDate(Math.min(start.getDate(), lastDay))
  return target
}

/**
 * Beitrag eines Plans zur Periode `[periodStart, periodEnd)`: sein voller
 * Betrag fuer jede Faelligkeit, die in die Periode faellt.
 *
 * Zugeteilt wird bei Faelligkeit, nicht angespart: Eine Jahresversicherung
 * ueber 600 € bekommt im Monat ihrer Abbuchung 600 €, in den anderen nichts.
 * Ansparen setzte ein Polster voraus, das es beim Einstieg nicht gibt — jeder
 * erste Durchlauf liefe ins Minus. So entspricht die Zuteilung dem, was im
 * Monat tatsaechlich abgeht. Faellig ist ein Plan ab `startDate` bis
 * einschliesslich `endDate`.
 */
function planContribution(plan: AllocationPlan, periodStart: Date, periodEnd: Date): number {
  const planStartKey = dayKey(plan.startDate)
  const planEndKey = plan.endDate ? dayKey(plan.endDate) : Number.POSITIVE_INFINITY
  const startKey = periodStart.getTime()
  const endKey = periodEnd.getTime()

  if (plan.frequency === 'ONCE') {
    return planStartKey >= startKey && planStartKey < endKey ? plan.amount : 0
  }

  let total = 0
  for (let index = 0; ; index++) {
    const dueKey = planDueDate(plan, index).getTime()
    if (dueKey >= endKey || dueKey > planEndKey) break
    if (dueKey >= startKey) total += plan.amount
  }
  return total
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

  // Ein ONCE-Umschlag hat kein Raster, in dessen Perioden Faelligkeiten
  // fallen koennten; aus Plaenen zuteilen koennen nur periodische Umschlaege.
  if (envelope.frequency === 'ONCE') return 0
  const start = new Date(dayKey(periodStart))
  const end = addPeriod(start, envelope.frequency)
  return rule.plans.reduce((total, plan) => total + planContribution(plan, start, end), 0)
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
 * Auch bei einem `ledgerSince` in der Zukunft (Migrationstag), sonst hinge das
 * Ergebnis davon ab, an welchem Tag zuerst abgerufen wird.
 */
export function getAllocationBookingDate(periodStart: Date, ledgerSince: Date): Date {
  const ledgerKey = dayKey(ledgerSince)
  return dayKey(periodStart) >= ledgerKey ? periodStart : new Date(ledgerKey)
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
  /** Ausgaben ÷ verfuegbar in %; null bei negativem Saldo ohne verfuegbares Geld. */
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
    // Saldo 0 ohne Ausgaben ist kein Ueberzug: Nichts da, aber auch nichts verbraucht.
    percentUsed: available > 0 ? (input.spent / available) * 100 : input.balance < 0 ? null : 0,
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
