/*
 * Endpoint-Tests fuer den Abgleich (issue #192): nur Auth und Parsen. Die
 * Regeln testet server/utils/__tests__/accounts.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const reconciliationMocks = vi.hoisted(() => ({
  computedAccountBalance: vi.fn(),
  reconcileAccount: vi.fn(),
  deleteAdjustment: vi.fn(),
}))
const authMocks = vi.hoisted(() => ({ requireHouseholdMembership: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))
vi.mock('../../../../utils/household-access', () => ({ requireHouseholdMembership: authMocks.requireHouseholdMembership }))
vi.mock('../../../../utils/account-reconciliation', () => reconciliationMocks)

import reconciliationGet from '../accounts/[id]/reconciliation.get'
import reconciliationPost from '../accounts/[id]/reconciliation.post'
import adjustmentDelete from '../account-adjustments/[id].delete'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function event(method: string, body?: Record<string, unknown>, url = '/'): H3Event {
  return {
    context: { params: { householdId: HH_ID, id: ID } },
    method,
    path: url,
    node: { req: { url, headers: { 'content-type': 'application/json' }, method, body }, res: {} },
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdMembership.mockResolvedValue({ user: { id: 'u1' } })
  reconciliationMocks.computedAccountBalance.mockResolvedValue({ balance: 3000 })
  reconciliationMocks.reconcileAccount.mockResolvedValue({ id: 'adj-1', amount: -750 })
  reconciliationMocks.deleteAdjustment.mockResolvedValue(undefined)
})

describe('reconciliation endpoints', () => {
  it('previews the computed balance at the end of the day', async () => {
    await expect(reconciliationGet(event('GET', undefined, '/?date=2026-11-22'))).resolves.toMatchObject({ computedBalance: 3000 })
    expect(reconciliationMocks.computedAccountBalance).toHaveBeenCalledWith(HH_ID, ID, expect.any(Date))
  })

  it('parses a negative stated balance (Dispo) and passes the member as author', async () => {
    const response = await reconciliationPost(event('POST', { date: '2026-11-22', statedBalance: '-120,50', note: ' ' }))

    expect(reconciliationMocks.reconcileAccount).toHaveBeenCalledWith(HH_ID, ID, 'u1', { date: expect.any(Date), statedBalance: -12050, note: null })
    expect(response).toEqual({ data: { kind: 'accountAdjustment', item: { id: 'adj-1', amount: -750 } } })
  })

  it('requires date and stated balance', async () => {
    await expect(reconciliationPost(event('POST', { statedBalance: 10 }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(reconciliationPost(event('POST', { date: '2026-11-22' }))).rejects.toMatchObject({ statusCode: 400 })
    expect(reconciliationMocks.reconcileAccount).not.toHaveBeenCalled()
  })

  it('deletes an adjustment by path id', async () => {
    await expect(adjustmentDelete(event('DELETE'))).resolves.toEqual({ data: { kind: 'accountAdjustment', deleted: true } })
    expect(reconciliationMocks.deleteAdjustment).toHaveBeenCalledWith(HH_ID, ID)
  })
})
