/*
 * Tests fuer die Umschlag- und Umbuchungs-Endpunkte (ADR-0005, #155):
 * Anlegen, Aendern (erst nachbuchen, dann aendern), Schliessen (auch nach
 * "Zu verteilen"), Loeschen nur ohne Spuren, Umbuchungen und gebuchte
 * Zuteilungen.
 *
 * Mock-Strategie wie transactions.post.test.ts: Prisma, Auth und
 * `ensureAllocations` gemockt, Parsing und Regeln laufen echt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  envelope: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  envelopeTransfer: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  expenseTransaction: { count: vi.fn() },
  incomeTransaction: { count: vi.fn() },
  $transaction: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
  requireHouseholdOwner: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({ ensureAllocations: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => authMocks)
vi.mock('../../../../utils/envelope-store', () => storeMocks)

import createEnvelope from '../envelopes.post'
import updateEnvelope from '../envelopes/[id].patch'
import deleteEnvelope from '../envelopes/[id].delete'
import closeEnvelope from '../envelopes/[id]/close.post'
import createTransfer from '../transfers.post'
import updateTransfer from '../transfers/[id].patch'
import deleteTransfer from '../transfers/[id].delete'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const ENV_ID = '3f1c2b4a-1111-4a2b-9c3d-123456789abc'
const OTHER_ID = '3f1c2b4a-2222-4a2b-9c3d-123456789abc'
const TRANSFER_ID = '3f1c2b4a-3333-4a2b-9c3d-123456789abc'

function makeEvent(body: Record<string, unknown> | undefined, params: Record<string, string> = {}): H3Event {
  return {
    context: { params: { householdId: HH_ID, ...params } },
    method: 'POST',
    node: {
      req: { url: '', headers: { 'content-type': 'application/json' }, method: 'POST', body: body ?? {} },
      res: {},
    },
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  const access = { user: { id: 'user-1' }, membership: { id: 'm-1', role: Role.OWNER } }
  authMocks.requireHouseholdMembership.mockResolvedValue(access)
  authMocks.requireHouseholdOwner.mockResolvedValue(access)
  prismaMocks.envelope.create.mockImplementation(async ({ data }) => ({ id: ENV_ID, ...data }))
  prismaMocks.envelope.update.mockImplementation(async ({ data }) => ({ id: ENV_ID, ...data }))
  prismaMocks.envelopeTransfer.create.mockImplementation(async ({ data }) => ({ id: TRANSFER_ID, ...data }))
  prismaMocks.envelopeTransfer.update.mockImplementation(async ({ data }) => ({ id: TRANSFER_ID, ...data }))
  prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => unknown) => callback(prismaMocks))
  for (const count of [prismaMocks.expenseTransaction.count, prismaMocks.incomeTransaction.count, prismaMocks.envelopeTransfer.count, prismaMocks.envelope.count]) {
    count.mockResolvedValue(0)
  }
})

describe('POST /envelopes', () => {
  it('applies the allocation default of the group', async () => {
    await createEnvelope(makeEvent({ name: 'Papa', group: 'PERSONAL' }))
    expect(prismaMocks.envelope.create.mock.calls[0][0].data).toMatchObject({
      name: 'Papa', group: 'PERSONAL', frequency: 'MONTHLY', allocationSource: 'NONE', allocationAmount: null,
    })
  })

  it('creates a weekly envelope with a fixed allocation from a period start', async () => {
    await createEnvelope(makeEvent({ name: 'Lebensmittel', group: 'RUNNING', frequency: 'WEEKLY', allocationAmount: '300', balanceSince: '2026-11-02' }))
    expect(prismaMocks.envelope.create.mock.calls[0][0].data).toMatchObject({
      frequency: 'WEEKLY', allocationSource: 'FIXED', allocationAmount: 30000,
    })
  })

  it('rejects a fixed allocation without amount', async () => {
    await expect(createEnvelope(makeEvent({ name: 'Kinder', group: 'RUNNING' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects allocations from plans for a ONCE envelope', async () => {
    await expect(createEnvelope(makeEvent({ name: 'X', group: 'FIXED', frequency: 'ONCE' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a balance start that is not a period start', async () => {
    await expect(
      createEnvelope(makeEvent({ name: 'Lebensmittel', group: 'RUNNING', frequency: 'WEEKLY', allocationAmount: 300, balanceSince: '2026-11-03' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an unknown group', async () => {
    await expect(createEnvelope(makeEvent({ name: 'X', group: 'BUDGET' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('PATCH /envelopes/:id', () => {
  const existing = { id: ENV_ID, householdId: HH_ID, frequency: 'MONTHLY', allocationSource: 'FIXED', allocationAmount: 25000 }

  it('books due allocations before changing the rule', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(existing)
    const order: string[] = []
    storeMocks.ensureAllocations.mockImplementation(async () => { order.push('ensure') })
    prismaMocks.envelope.update.mockImplementation(async () => { order.push('update'); return {} })

    await updateEnvelope(makeEvent({ allocationAmount: '280' }, { id: ENV_ID }))

    expect(order).toEqual(['ensure', 'update'])
    expect(prismaMocks.envelope.update.mock.calls[0][0].data).toMatchObject({ allocationSource: 'FIXED', allocationAmount: 28000 })
  })

  it('does not book allocations for a rename', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(existing)
    await updateEnvelope(makeEvent({ name: 'Kinder & Schule' }, { id: ENV_ID }))
    expect(storeMocks.ensureAllocations).not.toHaveBeenCalled()
  })

  it('clears the amount when switching away from a fixed allocation', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(existing)
    await updateEnvelope(makeEvent({ allocationSource: 'NONE' }, { id: ENV_ID }))
    expect(prismaMocks.envelope.update.mock.calls[0][0].data).toMatchObject({ allocationSource: 'NONE', allocationAmount: null })
  })

  it('404s for an envelope of another household', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(null)
    await expect(updateEnvelope(makeEvent({ name: 'x' }, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /envelopes/:id/close', () => {
  const open = { id: ENV_ID, householdId: HH_ID, frequency: 'MONTHLY', balanceSince: new Date(2026, 0, 1, 12), closedAt: null }

  it('closes into "Zu verteilen" with an explicit null target', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(open)

    await closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: null }, { id: ENV_ID }))

    expect(prismaMocks.envelope.update.mock.calls[0][0].data).toMatchObject({ carryoverToEnvelopeId: null })
    expect(storeMocks.ensureAllocations).toHaveBeenCalled()
    // Zuteilungen ab dem Stichtag gehoeren nicht mehr dem Umschlag.
    expect(prismaMocks.envelopeTransfer.deleteMany.mock.calls[0][0].where).toMatchObject({ toEnvelopeId: ENV_ID })
  })

  it('requires the target field so "Zu verteilen" is a deliberate choice', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(open)
    await expect(closeEnvelope(makeEvent({ closedAt: '2026-12-01' }, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('closes into another open envelope', async () => {
    prismaMocks.envelope.findFirst.mockImplementation(async ({ where }) => (where.id === ENV_ID ? open : { ...open, id: OTHER_ID }))
    await closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: OTHER_ID }, { id: ENV_ID }))
    expect(prismaMocks.envelope.update.mock.calls[0][0].data).toMatchObject({ carryoverToEnvelopeId: OTHER_ID })
  })

  it('rejects a target that does not exist', async () => {
    prismaMocks.envelope.findFirst.mockImplementation(async ({ where }) => (where.id === ENV_ID ? open : null))
    await expect(
      closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: OTHER_ID }, { id: ENV_ID })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('blocks when bookings exist on or after the closing date', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(open)
    prismaMocks.incomeTransaction.count.mockResolvedValue(1)
    await expect(
      closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: null }, { id: ENV_ID })),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a closing date that is not a period start', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue(open)
    await expect(
      closeEnvelope(makeEvent({ closedAt: '2026-12-15', carryoverToEnvelopeId: null }, { id: ENV_ID })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('DELETE /envelopes/:id', () => {
  it('deletes an envelope that only has allocations', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ id: ENV_ID })
    const response = await deleteEnvelope(makeEvent(undefined, { id: ENV_ID }))
    expect(response).toEqual({ data: { kind: 'envelope', deleted: true } })
    // Zuteilungen zaehlen nicht als Spur.
    expect(prismaMocks.envelopeTransfer.count.mock.calls[0][0].where).toMatchObject({ allocationPeriodStart: null })
  })

  it('refuses when the envelope has bookings', async () => {
    prismaMocks.envelope.findFirst.mockResolvedValue({ id: ENV_ID })
    prismaMocks.expenseTransaction.count.mockResolvedValue(1)
    await expect(deleteEnvelope(makeEvent(undefined, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 409 })
    expect(prismaMocks.envelope.delete).not.toHaveBeenCalled()
  })
})

describe('POST /transfers', () => {
  it('moves money from "Zu verteilen" into an envelope', async () => {
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: null }])

    await createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: '50', date: '2026-11-03', note: ' Rest ' }))

    expect(prismaMocks.envelopeTransfer.create.mock.calls[0][0].data).toMatchObject({
      householdId: HH_ID, fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: 5000, note: 'Rest', userId: 'user-1',
    })
    expect(prismaMocks.envelopeTransfer.create.mock.calls[0][0].data).not.toHaveProperty('allocationPeriodStart')
  })

  it('requires both sides to be given explicitly', async () => {
    await expect(createTransfer(makeEvent({ toEnvelopeId: ENV_ID, amount: 50, date: '2026-11-03' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a transfer between "Zu verteilen" and itself', async () => {
    await expect(
      createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: null, amount: 50, date: '2026-11-03' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a transfer into a closed envelope', async () => {
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: new Date(2026, 10, 1, 12) }])
    await expect(
      createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: 50, date: '2026-11-03' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a non-positive amount', async () => {
    await expect(
      createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: 0, date: '2026-11-03' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('PATCH/DELETE /transfers/:id', () => {
  const allocation = { id: TRANSFER_ID, householdId: HH_ID, fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: 25000, date: new Date(2026, 10, 1, 12), allocationPeriodStart: new Date(2026, 10, 1, 12) }

  it('lets the owner skip an allocation by setting it to 0', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue(allocation)
    await updateTransfer(makeEvent({ amount: 0 }, { id: TRANSFER_ID }))
    expect(authMocks.requireHouseholdOwner).toHaveBeenCalled()
    expect(prismaMocks.envelopeTransfer.update.mock.calls[0][0].data).toEqual({ amount: 0 })
  })

  it('does not allow moving an allocation to another envelope', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue(allocation)
    await expect(updateTransfer(makeEvent({ toEnvelopeId: OTHER_ID }, { id: TRANSFER_ID }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses to delete an allocation', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue({ allocationPeriodStart: allocation.allocationPeriodStart })
    await expect(deleteTransfer(makeEvent(undefined, { id: TRANSFER_ID }))).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.envelopeTransfer.delete).not.toHaveBeenCalled()
  })

  it('deletes an ordinary transfer', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue({ allocationPeriodStart: null })
    await expect(deleteTransfer(makeEvent(undefined, { id: TRANSFER_ID }))).resolves.toEqual({ data: { kind: 'transfer', deleted: true } })
  })

  it('re-checks the resulting sides and date of an ordinary transfer', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue({ ...allocation, allocationPeriodStart: null })
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: new Date(2026, 10, 15, 12) }])
    await expect(updateTransfer(makeEvent({ date: '2026-11-20' }, { id: TRANSFER_ID }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
