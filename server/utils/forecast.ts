/**
 * Forecast-Modus (issue #60 / ADR 0003).
 *
 * Pure Funktionen ohne HTTP/Auth/DB-Abhängigkeit. Liefert pro Budget eine
 * Hochrechnung auf Monatsende basierend auf dem bisherigen Ausgaben-Tempo
 * (dailyRate). Serverseitig berechnet (Issue-Spec: Server kennt den heutigen
 * Tag und hat Zugriff auf die DB-History), damit der Snapshot für alle
 * Mitglieder eines Haushalts konsistent ist.
 *
 * Formel (linear, kein gleitender Durchschnitt):
 *   dailyRate         = spentAmount / daysSinceStart
 *   forecastTotal     = spentAmount + (dailyRate * daysRemaining)
 *   forecastRemaining = plannedAmount - forecastTotal
 *
 * Severity (User-Spec aus issue #60):
 *   - on-track: forecastTotal <= plannedAmount
 *   - warning: forecastTotal in (planned, planned * 1.1]
 *   - over:    forecastTotal > planned * 1.1
 *
 * Edge cases sind in der ADR dokumentiert; die Tests in
 * `server/utils/__tests__/forecast.test.ts` decken sie ab.
 */

export type ForecastSeverity = 'on-track' | 'warning' | 'over'

export type BudgetForecast = {
  /**
   * Was am Monatsende voraussichtlich insgesamt ausgegeben sein wird (Cents).
   */
  forecastTotal: number
  /**
   * Was am Monatsende voraussichtlich noch übrig ist (Cents). Kann negativ
   * sein (über Plan).
   */
  forecastRemaining: number
  severity: ForecastSeverity
  /**
   * Anzahl Tage, die in die dailyRate eingeflossen sind. 0 bei today == monthStart
   * (Tag 1 des Monats).
   */
  basisDays: number
  /**
   * Snapshot des spentAmount zum Zeitpunkt der Berechnung. Identisch zu
   * `spentAmount` aus dem BudgetOverviewItem; hier separat für Transparenz
   * (Frontend kann anzeigen: "Stand 27.08., 1.234 € ausgegeben").
   */
  basisAmount: number
  /**
   * Server-Now als ISO-String, für Frontend-Anzeige ("Berechnet: ...").
   */
  computedAt: string
}

export type AggregatedForecast = {
  /**
   * Summe aller `forecastTotal` (Cents). Vergleichbar mit `monthSummary.expenses`,
   * aber als Hochrechnung auf Monatsende.
   */
  forecastTotal: number
  /**
   * Summe aller `plannedAmount` (Cents).
   */
  plannedTotal: number
  /**
   * Differenz: forecastTotal - plannedTotal. Negativ = im Plan, positiv = über Plan.
   */
  delta: number
  severity: ForecastSeverity
  computedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfDayUtc(date: Date): number {
  // Wir normalisieren auf Mitternacht UTC, damit Day-Berechnungen unabhängig
  // von der Timezone-Komponente des Date-Objekts sind. Im Backend ist
  // `today` immer Server-Time (UTC-nahe), `monthStart`/`monthEnd` aus
  // `getMonthWindow()` ebenfalls normalisiert (12:00 lokal — addieren wir
  // den Mittag-Anker nicht, da day-Math über den vollen Tag rundet).
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function daysBetween(later: Date, earlier: Date): number {
  // Anzahl voller Tage zwischen `earlier` (exklusiv) und `later` (inklusiv).
  // Beispiel: earlier = 1.8., later = 1.8. → 0 (gleicher Tag, nichts dazwischen).
  // earlier = 1.8., later = 2.8. → 1.
  const a = startOfDayUtc(later)
  const b = startOfDayUtc(earlier)
  return Math.round((a - b) / MS_PER_DAY)
}

/**
 * Klassifiziert die Forecast-Severity anhand von `forecastTotal` und
 * `plannedAmount`. Schwellwerte sind absichtlich ANDERS als die
 * Ist-Severity in `dashboard.ts`:
 *
 * - Ist:    >100% spent  → over,  >=80% → warning
 * - Forecast: >110% forecast → over,  >100% → warning
 *
 * Forecast ist eine Tempo-Aussage. User will früh gewarnt werden (bevor
 * 100% erreicht sind), aber auch nicht bei kleinen Abweichungen direkt
 * "over" sehen. 10%-Puffer ist die User-Spec aus issue #60.
 */
export function classifyForecastSeverity(
  forecastTotal: number,
  plannedAmount: number,
): ForecastSeverity {
  if (plannedAmount <= 0) return 'on-track' // Kein Plan = nichts zu verfehlen.
  if (forecastTotal > plannedAmount * 1.1) return 'over'
  if (forecastTotal > plannedAmount) return 'warning'
  return 'on-track'
}

// ---------------------------------------------------------------------------
// Per-Budget Forecast
// ---------------------------------------------------------------------------

/**
 * Berechnet den Forecast für ein einzelnes Budget.
 *
 * @param plannedAmount  Geplanter Betrag für den Monat (Cents)
 * @param spentAmount    Bisher ausgegebener Betrag (Cents)
 * @param monthStart     Erster Tag des Forecast-Zeitraums (inklusiv)
 * @param monthEnd       Erster Tag NACH dem Forecast-Zeitraum (exklusiv)
 * @param today          Heutiger Tag (default: `new Date()`)
 */
export function buildBudgetForecast(
  plannedAmount: number,
  spentAmount: number,
  monthStart: Date,
  monthEnd: Date,
  today: Date = new Date(),
): BudgetForecast {
  // Edge case: `today` außerhalb des Monats-Fensters → kappen.
  //   - today < monthStart: vor dem Monat, daysSinceStart = 0
  //   - today >= monthEnd: nach dem Monat, daysRemaining = 0
  const effectiveToday = today < monthStart
    ? monthStart
    : today >= monthEnd
      // 1 ms vor monthEnd → bleibt der letzte Tag im Monat (sonst hätten
      // wir daysRemaining = 0 und der Forecast entspräche nur dem Ist).
      ? new Date(monthEnd.getTime() - 1)
      : today

  const daysSinceStart = Math.max(0, daysBetween(effectiveToday, monthStart))
  const daysRemaining = Math.max(0, daysBetween(monthEnd, effectiveToday))

  // dailyRate: spentAmount pro Tag seit Monatsstart. Division-by-zero-Schutz
  // (Tag 1 des Monats → 0).
  const dailyRate = daysSinceStart > 0 ? spentAmount / daysSinceStart : 0

  // Linear extrapoliert. Cents × days = Cents (Rational-Arithmetik kann zu
  // Bruchteilen führen; Math.round kaufmännisch auf ganze Cents).
  const forecastTotal = Math.round(spentAmount + (dailyRate * daysRemaining))
  const forecastRemaining = plannedAmount - forecastTotal
  const severity = classifyForecastSeverity(forecastTotal, plannedAmount)

  return {
    forecastTotal,
    forecastRemaining,
    severity,
    basisDays: daysSinceStart,
    basisAmount: spentAmount,
    computedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Aggregierter Forecast
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<ForecastSeverity, number> = {
  'on-track': 0,
  warning: 1,
  over: 2,
}

/**
 * Aggregiert mehrere Budget-Forecasts zu einem Haushalts-Forecast.
 * Severity-Aggregation: max severity wins (wenn ein Budget over ist,
 * ist der Haushalt mindestens warning — und wenn eines over ist, ist
 * der Haushalt over). Konsistent mit der Logik in `dashboard.ts`
 * (SEVERITY_ORDER für die Action-Required-Sortierung).
 */
export function buildAggregatedForecast(
  forecasts: BudgetForecast[],
  plannedTotal: number,
  computedAt: string = new Date().toISOString(),
): AggregatedForecast {
  const forecastTotal = forecasts.reduce((sum, f) => sum + f.forecastTotal, 0)
  const delta = forecastTotal - plannedTotal

  let maxSeverity: ForecastSeverity = 'on-track'
  for (const f of forecasts) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = f.severity
    }
  }

  return {
    forecastTotal,
    plannedTotal,
    delta,
    severity: maxSeverity,
    computedAt,
  }
}
