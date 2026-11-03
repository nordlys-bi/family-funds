/*
 * Tests fuer `PATCH .../unassigned` (ADR-0005): Anfangsbestand und Stichtag
 * von "Zu verteilen", nur fuer OWNER, Anfangsbestand auch 0 oder negativ.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const planningMocks = vi.hoisted(() => ({ setLedgerStart: vi.fn() }))
const authMocks = vi.hoisted(() => ({ requireHouseholdOwner: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))
vi.mock('../../../../utils/envelope-planning', () => planningMocks)
vi.mock('../../../../utils/household-access', () => authMocks)

import updateUnassigned from '../unassigned.patch'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'

function makeEvent(body: Record<string, unknown>): H3Event {
  return {
    context: { params: { householdId: HH_ID } },
    method: 'PATCH',
    node: {
      req: { url: '', headers: { 'content-type': 'application/json' }, method: 'PATCH', body: JSON.stringify(body) },
      res: {},
    },
  } as unknown as H3Event
}

describe('PATCH /api/households/:id/unassigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planningMocks.setLedgerStart.mockResolvedValue({ ledgerSince: new Date(), openingBalance: 0 })
  })

  it.each([
    [1234.56, 123456],
    [0, 0],
    [-50.5, -5050],
    ['-50,50', -5050],
  ])('stores %s as %i cents', async (openingBalance, cents) => {
    await updateUnassigned(makeEvent({ openingBalance }))
    expect(authMocks.requireHouseholdOwner).toHaveBeenCalled()
    expect(planningMocks.setLedgerStart).toHaveBeenCalledWith(HH_ID, { openingBalance: cents })
  })

  it('parses the start date', async () => {
    await updateUnassigned(makeEvent({ ledgerSince: '2026-11-15' }))
    expect(planningMocks.setLedgerStart).toHaveBeenCalledWith(HH_ID, { ledgerSince: new Date('2026-11-15T12:00:00') })
  })

  it('rejects an empty update', async () => {
    await expect(updateUnassigned(makeEvent({}))).rejects.toMatchObject({ statusCode: 400 })
    expect(planningMocks.setLedgerStart).not.toHaveBeenCalled()
  })
})
