/**
 * Uebersicht aller Umschlaege eines Haushalts (ADR-0005) — die gemeinsame
 * Datenquelle fuer `GET .../envelopes` und das Dashboard.
 *
 * Pro Umschlag: Saldo, laufende Periode mit Bewertung nach Saldo,
 * Vormerkung bis Monatsende und ein grober Saldo-Trend. Dazu "Zu verteilen"
 * mit freiem und vorgemerktem Geld. Alles aus EINER Ladung der Buchungen;
 * vorher werden faellige Zuteilungen gebucht.
 */
import type { AllocationSource, EnvelopeGroup, Frequency } from '@prisma/client'
import { prisma } from './prisma'
import { dayKey } from './budget-balance'
import { addPeriod, startOfPeriod, type PeriodSeverity } from './budget-evaluation'
import { buildBudgetForecast } from './forecast'
import {
  classifyEnvelopeSeverity,
  computePeriodAvailability,
  listReservedAllocations,
  projectPeriodEndBalance,
} from './envelope-allocations'
import { computeEnvelopeBalances, computeUnassignedBalance, type EnvelopeBalance } from './envelope-balance'
import { ensureAllocations, loadEnvelopeBalanceInputs, toAllocationEnvelope } from './envelope-store'

export type EnvelopeCurrentPeriod = {
  start: Date
  end: Date
  /** Gebuchte Zuteilung der Periode. */
  allocation: number
  spent: number
  /** Saldo vor der Periode + Zuteilung. */
  available: number
  percentUsed: number | null
  /** Saldo am Periodenende bei gleichbleibendem Ausgabetempo (ADR-0003). */
  projectedEndBalance: number
}

export type EnvelopeOverviewItem = {
  id: string
  name: string
  group: EnvelopeGroup
  frequency: Frequency
  allocationSource: AllocationSource
  allocationAmount: number | null
  targetAmount: number | null
  targetDate: Date | null
  balanceSince: Date
  closedAt: Date | null
  carryoverToEnvelopeId: string | null
  fixedCostPlanIds: string[]
  /**
   * Spuren, an denen `DELETE .../envelopes/:id` scheitert (Buchungen inkl.
   * soft-geloeschter, Umbuchungen ausser Zuteilungen, Vorgaenger).
   */
  hasBookings: boolean
  balance: EnvelopeBalance
  severity: PeriodSeverity
  currentPeriod: EnvelopeCurrentPeriod | null
  /** Bis Monatsende noch faellige Zuteilungen (nur Frequenzen < Monat). */
  reserved: number
  /** Saldo im Wochenraster der letzten 3 Monate, aeltester zuerst. */
  balanceTrend: number[]
  createdAt: Date
  updatedAt: Date
}

export type UnassignedOverview = {
  balance: number
  /** Summe aller Vormerkungen bis Monatsende. */
  reserved: number
  /** `balance − reserved`: was wirklich noch verteilt werden kann. */
  free: number
  ledgerSince: Date
  openingBalance: number
}

export type EnvelopeOverview = {
  envelopes: EnvelopeOverviewItem[]
  unassigned: UnassignedOverview
}

const TREND_WEEKS = 13

function dayBefore(date: Date) {
  const value = new Date(dayKey(date))
  value.setDate(value.getDate() - 1)
  return value
}

export async function loadEnvelopeOverview(householdId: string, now: Date = new Date()): Promise<EnvelopeOverview> {
  await ensureAllocations(householdId, now)

  const [household, envelopes] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { ledgerSince: true, openingBalance: true } }),
    prisma.envelope.findMany({
      where: { householdId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        group: true,
        frequency: true,
        allocationSource: true,
        allocationAmount: true,
        targetAmount: true,
        targetDate: true,
        balanceSince: true,
        closedAt: true,
        carryoverToEnvelopeId: true,
        createdAt: true,
        updatedAt: true,
        fixedCostPlans: { select: { id: true, amount: true, frequency: true, startDate: true, endDate: true } },
        _count: {
          select: {
            expenses: true,
            incomes: true,
            predecessors: true,
            transfersOut: true,
            transfersIn: { where: { allocationPeriodStart: null } },
          },
        },
      },
    }),
  ])

  const inputs = await loadEnvelopeBalanceInputs(householdId, envelopes, household.ledgerSince)
  const balances = computeEnvelopeBalances(envelopes, inputs, now)
  const unassignedBalance = computeUnassignedBalance(household, envelopes, balances, inputs, now)

  // Salden vor der laufenden Periode — je Frequenz ein Stichtag, nicht je Umschlag.
  const balancesBefore = new Map<number, Map<string, EnvelopeBalance>>()
  const balancesBeforePeriod = (start: Date) => {
    let cached = balancesBefore.get(start.getTime())
    if (!cached) {
      cached = computeEnvelopeBalances(envelopes, inputs, dayBefore(start))
      balancesBefore.set(start.getTime(), cached)
    }
    return cached
  }

  const trendDates = Array.from({ length: TREND_WEEKS + 1 }, (_, index) => {
    const value = new Date(dayKey(now))
    value.setDate(value.getDate() - (TREND_WEEKS - index) * 7)
    return value
  })
  const trendBalances = trendDates.map((date) => computeEnvelopeBalances(envelopes, inputs, date))

  const nowKey = dayKey(now)
  let reservedTotal = 0

  const items = envelopes.map((envelope): EnvelopeOverviewItem => {
    const balance = balances.get(envelope.id)!
    const isOpen = !envelope.closedAt || nowKey < dayKey(envelope.closedAt)
    const allocationEnvelope = toAllocationEnvelope(envelope)

    let currentPeriod: EnvelopeCurrentPeriod | null = null
    if (isOpen && envelope.allocationSource !== 'NONE' && envelope.frequency !== 'ONCE') {
      const start = startOfPeriod(now, envelope.frequency)
      const end = addPeriod(start, envelope.frequency)
      const startKey = dayKey(start)
      const allocation = inputs.transfers
        .filter((transfer) => transfer.toEnvelopeId === envelope.id && transfer.allocationPeriodStart && dayKey(transfer.allocationPeriodStart) === startKey)
        .reduce((sum, transfer) => sum + transfer.amount, 0)
      const spent = inputs.expenses
        .filter((expense) => expense.envelopeId === envelope.id && dayKey(expense.date) >= startKey && dayKey(expense.date) <= nowKey)
        .reduce((sum, expense) => sum + expense.amount, 0)
      const before = balancesBeforePeriod(start).get(envelope.id)?.balance ?? 0
      const availability = computePeriodAvailability({ balanceBeforePeriod: before, periodAllocation: allocation, spent })
      const forecast = buildBudgetForecast(allocation, spent, start, end, now)
      currentPeriod = {
        start,
        end,
        allocation,
        spent,
        available: availability.available,
        percentUsed: availability.percentUsed,
        projectedEndBalance: projectPeriodEndBalance(balance.balance, spent, forecast.forecastTotal),
      }
    }

    const reserved = isOpen ? listReservedAllocations(allocationEnvelope, now).reduce((sum, item) => sum + item.amount, 0) : 0
    reservedTotal += reserved
    const counts = envelope._count

    return {
      id: envelope.id,
      name: envelope.name,
      group: envelope.group,
      frequency: envelope.frequency,
      allocationSource: envelope.allocationSource,
      allocationAmount: envelope.allocationAmount,
      targetAmount: envelope.targetAmount,
      targetDate: envelope.targetDate,
      balanceSince: envelope.balanceSince,
      closedAt: envelope.closedAt,
      carryoverToEnvelopeId: envelope.carryoverToEnvelopeId,
      fixedCostPlanIds: envelope.fixedCostPlans.map((plan) => plan.id),
      hasBookings: counts.expenses > 0 || counts.incomes > 0 || counts.predecessors > 0 || counts.transfersOut > 0 || counts.transfersIn > 0,
      balance,
      // Ein geschlossener Umschlag ist nie "ueberzogen": Sein Endsaldo steckt
      // schon im Ziel und wird dort bewertet.
      severity: isOpen
        ? classifyEnvelopeSeverity({ balance: balance.balance, projectedPeriodEndBalance: currentPeriod?.projectedEndBalance ?? null })
        : 'ok',
      currentPeriod,
      reserved,
      balanceTrend: trendBalances.map((map) => map.get(envelope.id)?.balance ?? 0),
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
    }
  })

  return {
    envelopes: items,
    unassigned: {
      balance: unassignedBalance,
      reserved: reservedTotal,
      free: unassignedBalance - reservedTotal,
      ledgerSince: household.ledgerSince,
      openingBalance: household.openingBalance,
    },
  }
}
