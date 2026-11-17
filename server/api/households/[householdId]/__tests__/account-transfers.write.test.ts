/*
 * Endpoint-Tests fuer Kontouebertraege (issue #191): nur Auth und Parsen. Die
 * Regeln testet server/utils/__tests__/accounts.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const transferMocks = vi.hoisted(() => ({
  createAccountTransfer: vi.fn(),
  updateAccountTransfer: vi.fn(),
  deleteAccountTransfer: vi.fn(),
}))
const authMocks = vi.hoisted(() => ({ requireHouseholdMembership: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))
vi.mock('../../../../utils/household-access', () => ({ requireHouseholdMembership: authMocks.requireHouseholdMembership }))
vi.mock('../../../../utils/account-transfers', () => transferMocks)

import transferPost from '../account-transfers.post'
import transferPatch from '../account-transfers/[id].patch'
import transferDelete from '../account-transfers/[id].delete'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const TRANSFER_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function event(method: string, body?: Record<string, unknown>, id?: string): H3Event {
  return {
    context: { params: { householdId: HH_ID, ...(id ? { id } : {}) } },
    method,
    path: '/',
    node: { req: { url: '/', headers: { 'content-type': 'application/json' }, method, body }, res: {} },
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdMembership.mockResolvedValue({ user: { id: 'u1' } })
  transferMocks.createAccountTransfer.mockResolvedValue({ id: TRANSFER_ID })
  transferMocks.updateAccountTransfer.mockResolvedValue({ id: TRANSFER_ID })
  transferMocks.deleteAccountTransfer.mockResolvedValue(undefined)
})

describe('POST /account-transfers', () => {
  it('parses accounts, amount in cents, date and note for any member', async () => {
    const response = await transferPost(event('POST', { fromAccountId: 'giro', toAccountId: 'cash', amount: '100,50', date: '2026-11-22', note: '  abheben ' }))

    expect(transferMocks.createAccountTransfer).toHaveBeenCalledWith(HH_ID, 'u1', {
      fromAccountId: 'giro',
      toAccountId: 'cash',
      amount: 10050,
      date: expect.any(Date),
      note: 'abheben',
    })
    expect(response).toEqual({ data: { kind: 'accountTransfer', item: { id: TRANSFER_ID } } })
  })

  it('requires both accounts and a positive amount', async () => {
    await expect(transferPost(event('POST', { toAccountId: 'cash', amount: 1, date: '2026-11-22' }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(transferPost(event('POST', { fromAccountId: 'giro', toAccountId: 'cash', amount: 0, date: '2026-11-22' }))).rejects.toMatchObject({ statusCode: 400 })
    expect(transferMocks.createAccountTransfer).not.toHaveBeenCalled()
  })
})

describe('PATCH/DELETE /account-transfers/:id', () => {
  it('passes only the changed fields', async () => {
    await transferPatch(event('PATCH', { note: '' }, TRANSFER_ID))
    expect(transferMocks.updateAccountTransfer).toHaveBeenCalledWith(HH_ID, TRANSFER_ID, { note: null })
  })

  it('deletes by path id', async () => {
    await expect(transferDelete(event('DELETE', undefined, TRANSFER_ID))).resolves.toEqual({ data: { kind: 'accountTransfer', deleted: true } })
    expect(transferMocks.deleteAccountTransfer).toHaveBeenCalledWith(HH_ID, TRANSFER_ID)
  })
})
