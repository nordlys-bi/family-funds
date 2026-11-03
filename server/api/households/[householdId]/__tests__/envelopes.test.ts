/*
 * Tests fuer die Umschlag- und Umbuchungs-Endpunkte (ADR-0005, #155):
 * Anlegen, Loeschen nur ohne Spuren, Umbuchungen und gebuchte Zuteilungen.
 * Bei Aendern und Schliessen nur Auth und Parsen; die Regeln dahinter testet
 * `server/utils/__tests__/envelope-planning.test.ts`.
 *
 * Mock-Strategie wie transactions.post.test.ts: Prisma und Auth gemockt,
 * Parsing und Regeln laufen echt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  envelope: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  envelopeTransfer: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  expenseTransaction: { count: vi.fn() },
  incomeTransaction: { count: vi.fn() },
  household: { findUniqueOrThrow: vi.fn() },
  $transaction: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
  requireHouseholdOwner: vi.fn(),
}))

const planningMocks = vi.hoisted(() => ({ updateEnvelope: vi.fn(), closeEnvelope: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../utils/household-access', () => authMocks)
vi.mock('../../../../utils/envelope-planning', () => planningMocks)

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
  prismaMocks.envelope.findMany.mockResolvedValue([])
  prismaMocks.household.findUniqueOrThrow.mockResolvedValue({ ledgerSince: new Date(2020, 0, 1, 12) })
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
  beforeEach(() => planningMocks.updateEnvelope.mockResolvedValue({ id: ENV_ID }))

  it('passes parsed changes on and wraps the response', async () => {
    const response = await updateEnvelope(makeEvent({ name: ' Schule ', group: 'RESERVE', allocationSource: 'FIXED', allocationAmount: '280', targetAmount: null }, { id: ENV_ID }))
    expect(authMocks.requireHouseholdOwner).toHaveBeenCalled()
    expect(planningMocks.updateEnvelope).toHaveBeenCalledWith(HH_ID, ENV_ID, {
      name: 'Schule',
      group: 'RESERVE',
      allocationSource: 'FIXED',
      allocationAmount: 28000,
      targetAmount: null,
    })
    expect(response).toEqual({ data: { kind: 'envelope', item: { id: ENV_ID } } })
  })

  it('passes nothing for fields the body does not contain', async () => {
    await updateEnvelope(makeEvent({ name: 'Schule' }, { id: ENV_ID }))
    expect(planningMocks.updateEnvelope.mock.calls[0][2]).toEqual({ name: 'Schule' })
  })

  it.each([
    ['name', { name: '  ' }],
    ['group', { group: 'OTHER' }],
    ['source', { allocationSource: 'OTHER' }],
    ['amount', { allocationAmount: 'abc' }],
  ])('rejects an invalid %s', async (_name, body) => {
    await expect(updateEnvelope(makeEvent(body, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 400 })
    expect(planningMocks.updateEnvelope).not.toHaveBeenCalled()
  })
})

describe('POST /envelopes/:id/close', () => {
  beforeEach(() => planningMocks.closeEnvelope.mockResolvedValue({ id: ENV_ID }))

  it('closes into "Zu verteilen" with an explicit null target', async () => {
    const response = await closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: null }, { id: ENV_ID }))
    expect(authMocks.requireHouseholdOwner).toHaveBeenCalled()
    expect(planningMocks.closeEnvelope).toHaveBeenCalledWith(HH_ID, ENV_ID, new Date('2026-12-01T12:00:00'), null)
    expect(response).toEqual({ data: { kind: 'envelope', item: { id: ENV_ID } } })
  })

  it('passes the target on', async () => {
    await closeEnvelope(makeEvent({ closedAt: '2026-12-01', carryoverToEnvelopeId: ` ${OTHER_ID} ` }, { id: ENV_ID }))
    expect(planningMocks.closeEnvelope.mock.calls[0][3]).toBe(OTHER_ID)
  })

  it('requires the target field so "Zu verteilen" is a deliberate choice', async () => {
    await expect(closeEnvelope(makeEvent({ closedAt: '2026-12-01' }, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 400 })
    expect(planningMocks.closeEnvelope).not.toHaveBeenCalled()
  })

  it('requires a closing date', async () => {
    await expect(closeEnvelope(makeEvent({ carryoverToEnvelopeId: null }, { id: ENV_ID }))).rejects.toMatchObject({ statusCode: 400 })
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

describe('POST /transfers before the start of "Zu verteilen"', () => {
  beforeEach(() => {
    prismaMocks.household.findUniqueOrThrow.mockResolvedValue({ ledgerSince: new Date(2026, 10, 4, 12) })
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: null, balanceSince: new Date(2026, 0, 1, 12) }, { id: OTHER_ID, closedAt: null, balanceSince: new Date(2026, 0, 1, 12) }])
  })

  it('rejects a transfer with "Zu verteilen" as one side', async () => {
    await expect(
      createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: '50', date: '2026-11-03' })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.envelopeTransfer.create).not.toHaveBeenCalled()
  })

  it('accepts it from the start day on', async () => {
    await createTransfer(makeEvent({ fromEnvelopeId: null, toEnvelopeId: ENV_ID, amount: '50', date: '2026-11-04' }))
    expect(prismaMocks.envelopeTransfer.create).toHaveBeenCalled()
  })

  it('still allows a transfer between two envelopes', async () => {
    await createTransfer(makeEvent({ fromEnvelopeId: ENV_ID, toEnvelopeId: OTHER_ID, amount: '50', date: '2026-11-03' }))
    expect(prismaMocks.envelopeTransfer.create).toHaveBeenCalled()
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

  it('rejects a transfer dated before the envelope start', async () => {
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: null, balanceSince: new Date(2026, 10, 1, 12) }])
    await expect(
      createTransfer(makeEvent({ fromEnvelopeId: ENV_ID, toEnvelopeId: null, amount: 50, date: '2026-10-15' })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.envelopeTransfer.create).not.toHaveBeenCalled()
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

  it('lets old transfers before the envelope start be corrected without moving them', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue({ ...allocation, allocationPeriodStart: null })
    await updateTransfer(makeEvent({ note: 'Korrektur', date: '2026-11-01' }, { id: TRANSFER_ID }))
    expect(prismaMocks.envelope.findMany).not.toHaveBeenCalled()
    expect(prismaMocks.envelopeTransfer.update).toHaveBeenCalledTimes(1)
  })

  it('re-checks the resulting sides and date of an ordinary transfer', async () => {
    prismaMocks.envelopeTransfer.findFirst.mockResolvedValue({ ...allocation, allocationPeriodStart: null })
    prismaMocks.envelope.findMany.mockResolvedValue([{ id: ENV_ID, closedAt: new Date(2026, 10, 15, 12) }])
    await expect(updateTransfer(makeEvent({ date: '2026-11-20' }, { id: TRANSFER_ID }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
