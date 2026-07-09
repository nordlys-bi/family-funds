/*
 * Household-Age-Helpers fuer First-Time-Empty-States (issue #13).
 *
 * `firstRun` bedeutet: der Haushalt wurde in den letzten 7 Tagen angelegt
 * (Schwelle kann via Parameter angepasst werden). In diesem Fall zeigen
 * Pages die First-Time-Empty-States mit Willkommens-Copy und CTAs statt
 * nur "Keine Daten"-Listen.
 *
 * Out-of-Scope: explizites `firstRun`-Flag in der DB. Wenn ein User nach
 * 7 Tagen noch keinen ersten Eintrag erfasst hat, faellt er automatisch
 * zurueck in den No-Data-Pfad — das ist okay, der Wechsel ist graduell
 * genug.
 */

const DEFAULT_FIRST_RUN_DAYS = 7

export type HouseholdLike = {
  createdAt?: string | null | undefined
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * True, wenn der Haushalt juenger als `thresholdDays` ist (Default 7).
 * Liefert `false` bei fehlendem oder nicht-parsbarem createdAt — sicher
 * (zeigt No-Data statt First-Time wenn das Datum fehlt).
 */
export function isFirstRun(
  household: HouseholdLike | null | undefined,
  now: Date = new Date(),
  thresholdDays: number = DEFAULT_FIRST_RUN_DAYS,
): boolean {
  if (!household?.createdAt) return false
  const created = new Date(household.createdAt)
  if (Number.isNaN(created.getTime())) return false
  const ageMs = now.getTime() - created.getTime()
  // Household kann nicht in der Zukunft angelegt sein — wenn ja,
  // behandeln wir es als First-Run (Uhrzeit-Drift etc.).
  if (ageMs < 0) return true
  return ageMs < thresholdDays * MS_PER_DAY
}

/** Anzahl der vollen Tage seit Haushalt-Erstellung. -1 wenn createdAt fehlt. */
export function householdAgeInDays(
  household: HouseholdLike | null | undefined,
  now: Date = new Date(),
): number {
  if (!household?.createdAt) return -1
  const created = new Date(household.createdAt)
  if (Number.isNaN(created.getTime())) return -1
  return Math.floor((now.getTime() - created.getTime()) / MS_PER_DAY)
}
