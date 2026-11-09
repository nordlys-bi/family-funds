/**
 * Wire-Typen fuer Umschlaege (ADR-0005), `GET .../envelopes` und
 * `GET .../envelopes/:id/history`.
 *
 * Datumswerte kommen als ISO-Strings (JSON-Serialisierung von `Date`),
 * Tage im Saldo-Verlauf als `YYYY-MM-DD`. Alle Betraege in Cent.
 */
import type { EnvelopeGroup } from '~/utils/envelope-options'
import type { Frequency } from './planning'

export type EnvelopeSeverity = 'ok' | 'warning' | 'over'

export type EnvelopeCurrentPeriod = {
  start: string
  /** Exklusiv (Beginn der Folgeperiode). */
  end: string
  /** Gebuchte Zuteilung der Periode. */
  allocation: number
  spent: number
  /** Aktueller Saldo + Ausgaben der Periode. */
  available: number
  /** Ausgaben ÷ verfuegbar in %; null, wenn nichts verfuegbar war. */
  /** null = im Minus, ohne dass etwas verfuegbar war. */
  percentUsed: number | null
}

export type EnvelopeItem = {
  id: string
  name: string
  group: EnvelopeGroup
  frequency: Frequency
  allocationSource: 'NONE' | 'FIXED' | 'PLANS'
  allocationAmount: number | null
  targetAmount: number | null
  targetDate: string | null
  balanceSince: string
  closedAt: string | null
  carryoverToEnvelopeId: string | null
  /** Buchungen, Umbuchungen oder Vorgaenger vorhanden — dann nur Schliessen, kein Loeschen. */
  hasBookings: boolean
  balance: { balance: number }
  severity: EnvelopeSeverity
  currentPeriod: EnvelopeCurrentPeriod | null
  /** Bis Monatsende noch faellige Zuteilungen. */
  reserved: number
  /** Saldo im Wochenraster der letzten 3 Monate (Sparkline). */
  balanceTrend: number[]
}

export type UnassignedOverview = {
  balance: number
  reserved: number
  free: number
}

export type EnvelopeHistoryEntry = {
  type: 'allocation' | 'income' | 'expense' | 'transfer' | 'carryover'
  id: string | null
  date: string
  /** Periode einer Zuteilung; kann bei Nachbuchungen vom Datum abweichen. */
  periodStart: string | null
  /** Wirkung auf den Saldo: + erhoeht, − senkt. */
  amount: number
  envelopeId: string
  envelopeName: string | null
  text: string | null
  /** Gegenseite einer Umbuchung oder Herkunft eines Uebertrags; null = "Zu verteilen". */
  counterpartId: string | null
  counterpartName: string | null
}

export type EnvelopeHistoryResponse = {
  envelopeId: string
  from: string
  to: string
  points: Array<{ date: string; balance: number }>
  entries: EnvelopeHistoryEntry[]
  chain: Array<{ id: string; name: string }>
}
