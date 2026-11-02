import { describe, expect, it } from 'vitest'
import { computeEnvelopeHistoryPoints, getEnvelopeChain, listEnvelopeHistoryEntries } from '../envelope-history'
import type { BalanceEnvelope } from '../envelope-balance'

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number) {
  return new Date(year, month - 1, date, 12, 0, 0, 0)
}

const weekly: BalanceEnvelope = { id: 'weekly', balanceSince: day(2026, 8, 3), closedAt: day(2026, 9, 1), carryoverToEnvelopeId: 'monthly' }
const monthly: BalanceEnvelope = { id: 'monthly', balanceSince: day(2026, 9, 1), closedAt: null, carryoverToEnvelopeId: null }
const other: BalanceEnvelope = { id: 'other', balanceSince: day(2026, 8, 1), closedAt: null, carryoverToEnvelopeId: null }

const inputs = {
  expenses: [
    { id: 'x1', envelopeId: 'weekly', amount: 1180, date: day(2026, 8, 30), description: 'Aral' },
    { id: 'x2', envelopeId: 'monthly', amount: 6683, date: day(2026, 9, 4), description: 'Jet' },
  ],
  incomes: [{ id: 'i1', envelopeId: 'monthly', amount: 500, date: day(2026, 9, 5), description: 'Pfand' }],
  transfers: [
    { id: 't1', fromEnvelopeId: null, toEnvelopeId: 'weekly', amount: 1000, date: day(2026, 8, 3), note: null, allocationPeriodStart: day(2026, 8, 3) },
    { id: 't2', fromEnvelopeId: null, toEnvelopeId: 'monthly', amount: 19000, date: day(2026, 9, 1), note: null, allocationPeriodStart: day(2026, 9, 1) },
    { id: 't3', fromEnvelopeId: 'monthly', toEnvelopeId: 'other', amount: 2000, date: day(2026, 9, 6), note: 'Puffer', allocationPeriodStart: null },
  ],
}

describe('getEnvelopeChain', () => {
  it('returns the envelope first, then its closed predecessors', () => {
    expect(getEnvelopeChain([weekly, monthly, other], 'monthly').map((envelope) => envelope.id)).toEqual(['monthly', 'weekly'])
    expect(getEnvelopeChain([weekly, monthly, other], 'other').map((envelope) => envelope.id)).toEqual(['other'])
  })
})

describe('computeEnvelopeHistoryPoints', () => {
  it('runs through the carryover without a jump', () => {
    const chain = getEnvelopeChain([weekly, monthly], 'monthly')
    const points = computeEnvelopeHistoryPoints(chain, inputs, day(2026, 8, 30), day(2026, 9, 2))
    expect(points.map((point) => point.balance)).toEqual([
      1000 - 1180, // 30.8.: noch der Vorgaenger
      1000 - 1180, // 31.8.
      19000 - 180, // 1.9.: Uebertrag + neue Zuteilung
      19000 - 180,
    ])
  })
})

describe('listEnvelopeHistoryEntries', () => {
  it('lists signed entries of the chain, newest first, including the carryover', () => {
    const chain = getEnvelopeChain([weekly, monthly, other], 'monthly')
    const entries = listEnvelopeHistoryEntries(chain, inputs, day(2026, 8, 1), day(2026, 9, 30))
    expect(entries.map((entry) => [entry.type, entry.amount, entry.envelopeId])).toEqual([
      ['transfer', -2000, 'monthly'],
      ['income', 500, 'monthly'],
      ['expense', -6683, 'monthly'],
      ['allocation', 19000, 'monthly'],
      ['carryover', -180, 'monthly'],
      ['expense', -1180, 'weekly'],
      ['allocation', 1000, 'weekly'],
    ])
    expect(entries[0]).toMatchObject({ counterpartId: 'other', text: 'Puffer' })
    expect(entries.find((entry) => entry.type === 'carryover')).toMatchObject({ counterpartId: 'weekly' })
  })

  it('only lists entries within the range', () => {
    const chain = getEnvelopeChain([weekly, monthly], 'monthly')
    const entries = listEnvelopeHistoryEntries(chain, inputs, day(2026, 9, 5), day(2026, 9, 5))
    expect(entries.map((entry) => entry.id)).toEqual(['i1'])
  })
})
