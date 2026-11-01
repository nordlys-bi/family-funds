import { describe, expect, it, vi } from 'vitest'

// envelope-store importiert den Prisma-Singleton als Default — hier wird
// immer ein eigenes `db` uebergeben, der Singleton darf nie benutzt werden.
vi.mock('../prisma', () => ({ prisma: {} }))

const { ensureAllocations, toAllocationRule } = await import('../envelope-store')

/** Lokales Datum, 12:00 — wie `parseDateInput`. */
function day(year: number, month: number, date: number, hour = 12) {
  return new Date(year, month - 1, date, hour, 0, 0, 0)
}

function makeDb(options: {
  envelopes: Array<Record<string, unknown>>
  booked?: Array<{ toEnvelopeId: string; allocationPeriodStart: Date }>
}) {
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
  const db = {
    envelope: { findMany: vi.fn(async () => options.envelopes) },
    envelopeTransfer: { findMany: vi.fn(async () => options.booked ?? []), createMany },
  }
  return { db: db as never, createMany }
}

const groceries = {
  id: 'groceries',
  frequency: 'WEEKLY',
  balanceSince: day(2026, 10, 19),
  closedAt: null,
  allocationSource: 'FIXED',
  allocationAmount: 30000,
  fixedCostPlans: [],
}

describe('ensureAllocations', () => {
  it('books every due period that is not booked yet', async () => {
    const { db, createMany } = makeDb({ envelopes: [groceries], booked: [{ toEnvelopeId: 'groceries', allocationPeriodStart: day(2026, 10, 19) }] })
    await expect(ensureAllocations('h1', day(2026, 11, 3), db)).resolves.toBe(2)
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { householdId: 'h1', fromEnvelopeId: null, toEnvelopeId: 'groceries', amount: 30000, date: day(2026, 10, 26), allocationPeriodStart: day(2026, 10, 26) },
        { householdId: 'h1', fromEnvelopeId: null, toEnvelopeId: 'groceries', amount: 30000, date: day(2026, 11, 2), allocationPeriodStart: day(2026, 11, 2) },
      ],
      skipDuplicates: true,
    })
  })

  it('writes nothing when everything is booked', async () => {
    const { db, createMany } = makeDb({
      envelopes: [groceries],
      booked: [day(2026, 10, 19), day(2026, 10, 26), day(2026, 11, 2)].map((date) => ({ toEnvelopeId: 'groceries', allocationPeriodStart: date })),
    })
    await expect(ensureAllocations('h1', day(2026, 11, 3), db)).resolves.toBe(0)
    expect(createMany).not.toHaveBeenCalled()
  })

  it('does not query transfers without allocating envelopes', async () => {
    const { db, createMany } = makeDb({ envelopes: [] })
    await expect(ensureAllocations('h1', day(2026, 11, 3), db)).resolves.toBe(0)
    expect(createMany).not.toHaveBeenCalled()
  })

  it('derives the amount from linked fixed-cost plans', async () => {
    const housing = {
      id: 'housing',
      frequency: 'MONTHLY',
      balanceSince: day(2026, 11, 1),
      closedAt: null,
      allocationSource: 'PLANS',
      allocationAmount: null,
      fixedCostPlans: [
        { amount: 95000, frequency: 'MONTHLY', startDate: day(2026, 1, 1), endDate: null },
        { amount: 60000, frequency: 'YEARLY', startDate: day(2026, 1, 1), endDate: null },
      ],
    }
    const { db, createMany } = makeDb({ envelopes: [housing] })
    await ensureAllocations('h1', day(2026, 11, 3), db)
    expect(createMany.mock.calls[0]?.[0].data).toEqual([expect.objectContaining({ toEnvelopeId: 'housing', amount: 100000 })])
  })
})

describe('toAllocationRule', () => {
  it('maps the stored source to a rule', () => {
    expect(toAllocationRule({ allocationSource: 'FIXED', allocationAmount: 500, fixedCostPlans: [] })).toEqual({ kind: 'fixed', amount: 500 })
    expect(toAllocationRule({ allocationSource: 'FIXED', allocationAmount: null, fixedCostPlans: [] })).toEqual({ kind: 'fixed', amount: 0 })
    expect(toAllocationRule({ allocationSource: 'NONE', allocationAmount: 500, fixedCostPlans: [] })).toEqual({ kind: 'none' })
  })
})
