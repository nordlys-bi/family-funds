/*
 * savings-progress — Aggregation der monatlichen Plan-vs-Ist-Werte
 * pro Sparziel (issue #56).
 *
 * Motivation: Auf der Sparziel-Card wurde bisher nur der Overall-
 * Progress (currentAmount / targetAmount) gezeigt. Die Frage
 * "Bin ich diesen Monat auf Kurs?" blieb unbeantwortet. Dieses
 * Modul berechnet pro Goal ein Array `monthlyProgress[]` fuer die
 * letzten N Monate (Default 3), das die Card im Frontend als
 * "Januar: geplant 50 €, real 35 € (70 %)"-Tag und aufklappbaren
 * 3-Monats-Verlauf rendert.
 *
 * Datenmodell:
 *  - Goal hat `monthlyRate` (geplante Sparrate pro Monat, in Cent)
 *  - Goal hat `executions[]` mit `amount` (real gebucht, in Cent)
 *    und `date` (welcher Monat)
 *
 * Edge Cases:
 *  - monthlyRate = 0: Plan-Vergleich ist sinnlos. Wir geben in dem
 *    Fall `planned: 0, percentUsed: 0` aus. Die Page blendet die
 *    Prozent-Anzeige dann aus und zeigt nur die Ist-Summe.
 *  - monthlyRate < 0 (Entnahme-Plan): Gleiche Logik wie 0 — der
 *    Plan-Vergleich wird im Frontend ausgeblendet. negative Rate
 *    wuerde sonst bei actual >= 0 "fuenf Prozent" oder aehnlich
 *    Quatsch produzieren.
 *  - Keine Executions in einem Monat: actual = 0, percentUsed = 0.
 *  - Monat liegt in der Zukunft (z. B. wenn der Server mit fixed
 *    `now` laeuft): wir geben den Eintrag trotzdem aus mit actual=0,
 *    damit die Card die volle History-Laenge rendert.
 *
 * Sortierung: neueste zuerst (currentMonth, -1, -2, ...).
 *
 * Timezone-Hinweis: wir nutzen lokale Zeit (setHours/setMonth) wie
 * der Rest des Codes (siehe budget-evaluation.ts: `startOfDay` mit
 * 12:00 Local). Das ist absichtlich konsistent, damit ein
 * datepicker-gebuchtes Datum (UTC-mitternacht in der DB) zuverlaessig
 * in den richtigen Monats-Bucket faellt, egal in welcher TZ der
 * Server laeuft.
 */
export type SavingsGoalExecutionLike = {
  amount: number
  date: Date | string
}

export type SavingsGoalWithExecutions = {
  monthlyRate: number
  executions: SavingsGoalExecutionLike[]
}

export type MonthlyProgressItem = {
  /** 'YYYY-MM' (lokale Zeit) — die Card nutzt das als Lookup-Key. */
  month: string
  /** Geplante Sparrate in dem Monat (aus Goal.monthlyRate, in Cent). */
  planned: number
  /** Summe der Execution-Amounts in dem Monat (in Cent). */
  actual: number
  /**
   * Prozentuale Auslastung: actual / planned * 100, gerundet auf 1
   * Nachkommastelle, gedeckelt bei 999 (verhindert 'Infinity %' bei
   * planned=0). Bei planned<=0 ist percentUsed 0.
   */
  percentUsed: number
}

/**
 * Berechnet das [start, end)-Fenster fuer einen Monat, der `offset`
 * Monate VOR `baseDate` liegt. offset=0 ist der aktuelle Monat,
 * offset=1 der Vormonat, offset=2 der Monat davor, etc.
 *
 * Beide Zeitpunkte werden auf 12:00 lokal normalisiert, damit
 * Vergleiche gegen `execution.date` robust gegen Mitternachts-Drift
 * sind (gleiche Konvention wie `getMonthWindow` in
 * budget-evaluation.ts).
 */
export function getMonthWindowForOffset(
  offset: number,
  baseDate: Date = new Date(),
): { monthStart: Date; monthEnd: Date } {
  if (offset < 0) {
    throw new Error(`offset must be >= 0, got ${offset}`)
  }
  const monthStart = new Date(baseDate)
  monthStart.setHours(12, 0, 0, 0)
  monthStart.setDate(1)
  // offset Monate zurueck: 0 = aktueller Monat
  monthStart.setMonth(monthStart.getMonth() - offset)

  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  return { monthStart, monthEnd }
}

/**
 * Formatiert ein Date als 'YYYY-MM'. Nutzt lokale Zeit-Komponenten,
 * passend zu `getMonthWindowForOffset`.
 */
export function formatMonthKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Berechnet die monthlyProgress-Liste fuer ein einzelnes Goal.
 *
 * @param goal  Goal mit monthlyRate und executions[] (kann leer sein)
 * @param months Anzahl der Monate, default 3 (current + 2 previous)
 * @param now  "Heute"-Referenz, default `new Date()`. Wird hier
 *   nur als Test-Hook gebraucht, damit Tests deterministisch
 *   laufen koennen.
 * @returns Array mit `months` Items, neueste zuerst
 */
export function buildSavingsMonthlyProgress(
  goal: SavingsGoalWithExecutions,
  months: number = 3,
  now: Date = new Date(),
): MonthlyProgressItem[] {
  if (months <= 0) return []

  const result: MonthlyProgressItem[] = []

  for (let offset = 0; offset < months; offset += 1) {
    const { monthStart, monthEnd } = getMonthWindowForOffset(offset, now)
    const monthKey = formatMonthKey(monthStart)

    const actual = goal.executions.reduce((sum, execution) => {
      const execDate = execution.date instanceof Date
        ? execution.date
        : new Date(execution.date)
      if (Number.isNaN(execDate.getTime())) return sum
      if (execDate >= monthStart && execDate < monthEnd) {
        return sum + execution.amount
      }
      return sum
    }, 0)

    const planned = goal.monthlyRate
    // percentUsed: nur berechnen wenn planned > 0, sonst 0. Bei
    // negativer Rate soll das Frontend den Plan-Vergleich komplett
    // ausblenden — percentUsed auf 0 ist der harmloseste Default.
    const percentUsed = planned > 0
      ? Math.min(999, Math.round((actual / planned) * 1000) / 10)
      : 0

    result.push({
      month: monthKey,
      planned,
      actual,
      percentUsed,
    })
  }

  return result
}
