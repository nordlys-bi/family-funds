/*
 * recurring-periods — Period-Bucket-Logik fuer Recurring-Plaene
 * (issue #59, ADR 0002).
 *
 * Wir berechnen fuer einen `FixedCostPlan` oder `IncomePlan` die
 * "due" Period-Buckets in einem gegebenen Anzeige-Scope (aktueller
 * Monat) und pruefen fuer jeden Bucket, ob mindestens eine zugehoerige
 * Transaktion existiert. Aus due + paid wird der Coverage-Percent
 * abgeleitet.
 *
 * Period-Bucket-Regeln pro Frequency:
 *  - MONTHLY:  1 Bucket pro Monat
 *  - WEEKLY:   4–5 Buckets pro Monat, Mo–So, der Montag entscheidet
 *              die Monatszugehoerigkeit
 *  - QUARTERLY: 0 oder 1 Bucket pro Monat, abhaengig vom Startmonat
 *              (startDate.getMonth() % 3 == currentMonth % 3)
 *  - YEARLY:   0 oder 1 Bucket pro Monat (nur im Monat des startDate)
 *  - ONCE:     0 oder 1 Bucket im Fenster startDate..endDate
 *
 * Non-Due-Monate: Plan wird vom Frontend ausgeblendet (nicht von hier
 * entschieden — der Endpoint liefert einfach due: 0, das Frontend
 * kann das rendern wie es will).
 *
 * Vergleichs-Logik: zwei Datums-Vergleiche mit `start` und `end`
 * (exklusiv Ende), damit eine Buchung am letzten Tag des Vormonats
 * nicht in den aktuellen Monat zaehlt.
 */
export type RecurringFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONCE'

export type RecurringPlanLike = {
  startDate: Date | string
  endDate: Date | string | null
  frequency: RecurringFrequency
}

export type PeriodBucket = {
  /** Eindeutige ID fuer diesen Bucket (z. B. '2026-06' fuer monthly, '2026-W23' fuer weekly). */
  key: string
  /** Erster Tag des Buckets (inklusive). */
  start: Date
  /** Erster Tag NACH dem Bucket (exklusiv). */
  end: Date
}

export type RecurringPeriod = {
  buckets: PeriodBucket[]
  /**
   * Naechste Due-Period (>= now). null wenn der Plan bereits
   * abgelaufen ist (z. B. ONCE nach endDate).
   */
  nextDueDate: Date | null
}

/**
 * Liefert alle Period-Buckets fuer `plan` im Monat `year`/`month`
 * (0-indexed, lokal), sowie die nextDueDate-Information.
 *
 * Edge Cases:
 *  - startDate liegt in der Zukunft -> buckets sind leer, nextDueDate
 *    ist startDate (sofern frequency danach Perioden produziert)
 *  - endDate vor dem aktuellen Monat -> buckets sind leer, nextDueDate
 *    null (Plan ist vor dem Anzeige-Scope abgelaufen)
 *  - endDate innerhalb des aktuellen Monats -> 1 Bucket (Plan war
 *    in diesem Monat aktiv, selbst wenn er schon abgelaufen ist)
 *  - WEEKLY Plan mit startDate vor Monatsbeginn -> nur die Wochen, deren
 *    Montag im aktuellen Monat liegt
 */
export function getRecurringPeriodsInMonth(
  plan: RecurringPlanLike,
  year: number,
  month: number, // 0-indexed (0 = Jan, 11 = Dec)
  now: Date = new Date(),
): RecurringPeriod {
  const startDate = toDate(plan.startDate)
  const endDate = plan.endDate ? toDate(plan.endDate) : null

  const monthStart = new Date(year, month, 1, 0, 0, 0, 0)
  const monthEnd = new Date(year, month + 1, 1, 0, 0, 0, 0)

  // Wenn der Plan VOR dem aktuellen Monat abgelaufen ist, keine
  // Buckets. endDate innerhalb des Monats ist OK (Plan war in dem
  // Monat aktiv, auch wenn er vor now() endete).
  if (endDate && endDate.getTime() < monthStart.getTime()) {
    return { buckets: [], nextDueDate: null }
  }

  const buckets = computeBucketsInRange(plan, startDate, endDate, monthStart, monthEnd)

  // nextDueDate: erste Periode >= now. Fuer MONTHLY: erster Tag des
  // aktuellen Monats, falls noch nicht bezahlt. Fuer WEEKLY: der
  // Montag der aktuellen Woche, falls im aktuellen Monat.
  const nextDueDate = computeNextDueDate(plan, startDate, endDate, now, monthStart, monthEnd, buckets)

  return { buckets, nextDueDate }
}

/**
 * Prueft, ob eine Transaktion mit `transactionDate` in einen
 * bestimmten Period-Bucket faellt. Verwendet [start, end) Halb-Offen-
 * Intervall — eine Transchnung am letzten Tag eines Buckets gehoert
 * zum naechsten Bucket.
 */
export function isDateInBucket(transactionDate: Date | string, bucket: PeriodBucket): boolean {
  const date = toDate(transactionDate)
  return date >= bucket.start && date < bucket.end
}

/**
 * Berechnet den Coverage-Percent (0-100, ggf. mit Nachkommastellen)
 * fuer einen Plan: paid / due * 100. Wenn due = 0, ist percent 0
 * (sollte aber vom Caller als "kein Status" interpretiert werden).
 */
export function computeCoveragePercent(paid: number, due: number): number {
  if (due <= 0) return 0
  return Math.min(100, Math.round((paid / due) * 1000) / 10)
}

// =====================================================================
// Internal helpers
// =====================================================================

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Setzt die Stunden auf 0, damit reine Datums-Vergleiche
 * (Monat, Woche) robust gegen Timezones sind. Lokal — konsistent
 * mit `startOfDay` in budget-evaluation.ts.
 */
function startOfDay(date: Date): Date {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function computeBucketsInRange(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): PeriodBucket[] {
  switch (plan.frequency) {
    case 'MONTHLY':
      return computeMonthlyBuckets(plan, startDate, endDate, rangeStart, rangeEnd)
    case 'WEEKLY':
      return computeWeeklyBuckets(plan, startDate, endDate, rangeStart, rangeEnd)
    case 'QUARTERLY':
      return computePeriodicMonthBuckets(plan, startDate, endDate, rangeStart, rangeEnd, 3)
    case 'YEARLY':
      return computeYearlyBuckets(plan, startDate, endDate, rangeStart, rangeEnd)
    case 'ONCE':
      return computeOnceBucket(plan, startDate, endDate, rangeStart, rangeEnd)
    default:
      return []
  }
}

function computeMonthlyBuckets(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): PeriodBucket[] {
  // Effektiver Period-Anker: das spaetere aus startDate und rangeStart.
  // Vor startDate gibt es keine Buckets, weil der Plan noch nicht laeuft.
  const effectiveStart = startOfDay(
    startDate.getTime() > rangeStart.getTime() ? startDate : rangeStart,
  )
  // Auf den 1. des Monats normalisieren (fuer key-Vergleichbarkeit).
  effectiveStart.setDate(1)

  const buckets: PeriodBucket[] = []
  let cursor = new Date(effectiveStart)

  while (cursor.getTime() < rangeEnd.getTime()) {
    const bucketEnd = new Date(cursor)
    bucketEnd.setMonth(bucketEnd.getMonth() + 1)

    // Bucket endet vor plan.endDate? Normalerweise endet der Plan
    // sowieso zum Monatsende, daher prüfen wir nicht strenger.
    if (endDate && bucketEnd.getTime() > endDate.getTime() && endDate.getTime() <= cursor.getTime()) {
      break
    }

    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    buckets.push({ key, start: new Date(cursor), end: bucketEnd })

    cursor = bucketEnd
  }

  return buckets
}

function computeWeeklyBuckets(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): PeriodBucket[] {
  // Wir iterieren alle Wochen, deren Montag im [rangeStart, rangeEnd)
  // liegt. "Montag entscheidet Monatszugehoerigkeit" — eine Woche
  // von Mo 30.6. bis So 6.7. gehoert zu Juni (Montag im Juni).
  const buckets: PeriodBucket[] = []

  // Start mit dem Montag der Woche, die rangeStart enthaelt
  let cursor = mondayOf(startOfDay(rangeStart))

  // Wenn startDate nach cursor liegt, vorruecken.
  const planStartMonday = mondayOf(startOfDay(startDate))
  if (planStartMonday.getTime() > cursor.getTime()) {
    cursor = new Date(planStartMonday)
  }

  while (cursor.getTime() < rangeEnd.getTime()) {
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 7)

    // Ueber plan.endDate hinaus?
    if (endDate && weekEnd.getTime() > endDate.getTime() + 7 * 24 * 60 * 60 * 1000) {
      // Wenn der Plan endet, schliessen wir die letzte Woche ab
      // und brechen dann ab. Erlauben, dass die letzte Transaktion
      // am endDate noch in den Bucket zaehlt.
      if (cursor.getTime() > endDate.getTime()) break
    }

    // ISO-Week-Key: YYYY-Www (z. B. '2026-W23')
    const key = isoWeekKey(cursor)
    buckets.push({ key, start: new Date(cursor), end: weekEnd })

    cursor = weekEnd
  }

  return buckets
}

function computePeriodicMonthBuckets(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
  periodMonths: number,
): PeriodBucket[] {
  // 0 oder 1 Bucket pro Monat, abhaengig von der Anker-Kongruenz
  // startDate.getMonth() % periodMonths == currentMonth % periodMonths.
  // QUARTERLY: periodMonths=3, YEARLY: periodMonths=12 (spezialfall,
  // siehe unten).
  const anchorMonth = startDate.getMonth()
  const startYear = startDate.getFullYear()
  const rangeStartMonth = rangeStart.getMonth()
  const rangeStartYear = rangeStart.getFullYear()

  // Kongruenz pruefen: ist der Monat von rangeStart ein Due-Monat
  // relativ zum startDate-Anker?
  // Berechne "Monats-Index" relativ zu startDate
  const anchorIndex = startYear * 12 + anchorMonth
  const candidateIndex = rangeStartYear * 12 + rangeStartMonth
  const diff = candidateIndex - anchorIndex

  if (diff < 0) return [] // rangeStart vor startDate
  if (diff % periodMonths !== 0) return [] // kein Due-Monat

  // Bucket = der Monat rangeStart
  const bucketStart = new Date(rangeStart)
  bucketStart.setDate(1)
  const bucketEnd = new Date(bucketStart)
  bucketEnd.setMonth(bucketEnd.getMonth() + 1)

  if (endDate && bucketEnd.getTime() > endDate.getTime()) {
    // endDate innerhalb des Buckets: behalte den Bucket, weil die
    // Faelligkeit vor endDate liegt
    if (endDate.getTime() < bucketStart.getTime()) return []
  }

  const key = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, '0')}`
  return [{ key, start: bucketStart, end: bucketEnd }]
}

function computeYearlyBuckets(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): PeriodBucket[] {
  // 0 oder 1 Bucket pro Monat, abhaengig vom Monat des startDate.
  if (startDate.getMonth() !== rangeStart.getMonth()) return []

  const bucketStart = new Date(rangeStart)
  bucketStart.setDate(1)
  const bucketEnd = new Date(bucketStart)
  bucketEnd.setFullYear(bucketEnd.getFullYear() + 1)

  const key = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, '0')}`
  return [{ key, start: bucketStart, end: bucketEnd }]
}

function computeOnceBucket(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): PeriodBucket[] {
  // 1 Bucket, wenn der aktuelle Anzeige-Scope (Monat) sich mit dem
  // ONCE-Fenster [startDate, endDate] ueberschneidet. Der Bucket ist
  // der aktuelle Monat (nicht der startDate-Monat!), weil "ONCE in
  // diesem Monat" die Frage ist, die der User stellt.
  if (startDate.getTime() >= rangeEnd.getTime()) return []
  if (endDate && endDate.getTime() <= rangeStart.getTime()) return []

  // Bucket = der aktuelle Anzeige-Scope (rangeStart..rangeEnd)
  const bucketStart = new Date(rangeStart)
  const bucketEnd = new Date(rangeEnd)
  const key = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, '0')}`
  return [{ key, start: bucketStart, end: bucketEnd }]
}

function computeNextDueDate(
  plan: RecurringPlanLike,
  startDate: Date,
  endDate: Date | null,
  now: Date,
  rangeStart: Date,
  rangeEnd: Date,
  buckets: PeriodBucket[],
): Date | null {
  // Vereinfachung: wenn es in diesem Monat Buckets gibt, ist die
  // naechste Faelligkeit der erste Bucket-Start >= now. Sonst
  // berechnen wir die naechste Periode nach diesem Monat.
  const nowInRange = now >= rangeStart && now < rangeEnd
  if (nowInRange) {
    for (const bucket of buckets) {
      if (bucket.end > now) return bucket.start
    }
    return null
  }

  // now liegt vor oder nach rangeStart/rangeEnd. Einfache Heuristik:
  // wenn now < rangeStart, ist die naechste Faelligkeit rangeStart
  // (Anfang des aktuellen Anzeige-Monats). Wenn now >= rangeEnd,
  // ist die naechste Faelligkeit der erste Tag des naechsten
  // Monats, der eine Faelligkeit hat (vom Backend nicht spezifiziert
  // — wir liefern hier null, weil der Caller die Berechnung selbst
  // machen kann oder einfach den naechsten Monat pollt).
  if (now < rangeStart) return rangeStart
  return null
}

/**
 * Liefert den Montag der Woche, in der `date` liegt. Setzt die Zeit
 * auf 00:00 lokal.
 */
function mondayOf(date: Date): Date {
  const value = startOfDay(new Date(date))
  const day = value.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = day === 0 ? -6 : 1 - day
  value.setDate(value.getDate() + diff)
  return value
}

/**
 * ISO-Week-Key im Format 'YYYY-Www' (z. B. '2026-W23'). Folge der
 * ISO-8601-Definition: Woche 1 ist die Woche mit dem ersten Donnerstag
 * des Jahres, Montag ist der erste Tag der Woche.
 */
function isoWeekKey(date: Date): string {
  // ISO-Woche: Kopie von date, naechster Donnerstag bestimmt das Jahr
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  // Donnerstag der aktuellen Woche
  value.setDate(value.getDate() + 4 - (value.getDay() || 7))
  const year = value.getFullYear()
  // Jahr-Anfang (1. Januar) der Donnerstag-Woche
  const yearStart = new Date(year, 0, 1)
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}
