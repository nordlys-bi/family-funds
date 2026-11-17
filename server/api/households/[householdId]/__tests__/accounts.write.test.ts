/*
 * Endpoint-Tests fuer Konten (issue #189): nur Auth und Parsen. Die Regeln
 * testet server/utils/__tests__/accounts.test.ts gegen den In-Memory-Adapter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const accountMocks = vi.hoisted(() => ({
  introduceAccounts: vi.fn(),
  previewIntroduction: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
const authMocks = vi.hoisted(() => ({ requireHouseholdOwner: vi.fn() }))

vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))
vi.mock('../../../../utils/household-access', () => ({ requireHouseholdOwner: authMocks.requireHouseholdOwner }))
vi.mock('../../../../utils/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/accounts')>()),
  ...accountMocks,
}))

import introductionPost from '../accounts/introduction.post'
import introductionGet from '../accounts/introduction.get'
import accountsPost from '../accounts.post'
import accountPatch from '../accounts/[id].patch'
import accountDelete from '../accounts/[id].delete'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const ACCOUNT_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function event(method: string, body?: Record<string, unknown>, extra: { id?: string; url?: string } = {}): H3Event {
  return {
    context: { params: { householdId: HH_ID, ...(extra.id ? { id: extra.id } : {}) } },
    method,
    path: extra.url ?? '/',
    node: {
      req: { url: extra.url ?? '/', headers: { 'content-type': 'application/json' }, method, body },
      res: {},
    },
  } as unknown as H3Event
}

const forbidden = { statusCode: 403, statusMessage: 'Only owners can do this.' }

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdOwner.mockResolvedValue({ user: { id: 'u1' } })
  accountMocks.introduceAccounts.mockResolvedValue([{ id: 'acc-1' }])
  accountMocks.previewIntroduction.mockResolvedValue({ envelopesBefore: 0 })
  accountMocks.createAccount.mockResolvedValue({ id: 'acc-2' })
  accountMocks.updateAccount.mockResolvedValue({ id: ACCOUNT_ID })
  accountMocks.deleteAccount.mockResolvedValue(undefined)
})

describe('POST /accounts/introduction', () => {
  it('parst Datum, Konten und das Konto fuer bestehende Buchungen', async () => {
    const response = await introductionPost(event('POST', {
      date: '2026-11-20',
      accounts: [{ name: ' Girokonto ', type: 'CHECKING', openingBalance: '-12,50' }, { name: 'Geldbeutel', type: 'CASH' }],
      existingBookingsAccount: 1,
    }))

    expect(accountMocks.introduceAccounts).toHaveBeenCalledWith(
      HH_ID,
      new Date(2026, 10, 20, 12, 0, 0, 0),
      [{ name: 'Girokonto', type: 'CHECKING', openingBalance: -1250 }, { name: 'Geldbeutel', type: 'CASH', openingBalance: 0 }],
      1,
    )
    expect(response).toEqual({ data: { kind: 'accounts', items: [{ id: 'acc-1' }] } })
  })

  it.each([
    ['ohne Konten', { date: '2026-11-20' }],
    ['mit unbekannter Kontoart', { date: '2026-11-20', accounts: [{ name: 'X', type: 'CREDIT' }] }],
    ['ohne Namen', { date: '2026-11-20', accounts: [{ name: ' ', type: 'CASH' }] }],
    ['ohne Datum', { accounts: [{ name: 'X', type: 'CASH' }] }],
    ['mit ungueltigem Index', { date: '2026-11-20', accounts: [{ name: 'X', type: 'CASH' }], existingBookingsAccount: 'eins' }],
  ])('400 %s', async (_name, body) => {
    await expect(introductionPost(event('POST', body))).rejects.toMatchObject({ statusCode: 400 })
    expect(accountMocks.introduceAccounts).not.toHaveBeenCalled()
  })

  it('403 fuer Nicht-Owner', async () => {
    authMocks.requireHouseholdOwner.mockRejectedValue(forbidden)
    await expect(introductionPost(event('POST', { date: '2026-11-20', accounts: [] }))).rejects.toMatchObject({ statusCode: 403 })
    expect(accountMocks.introduceAccounts).not.toHaveBeenCalled()
  })
})

describe('GET /accounts/introduction', () => {
  it('nimmt das Datum aus der Query', async () => {
    await introductionGet(event('GET', undefined, { url: '/x?date=2026-11-20' }))
    expect(accountMocks.previewIntroduction).toHaveBeenCalledWith(HH_ID, new Date(2026, 10, 20, 12, 0, 0, 0))
  })

  it('403 fuer Nicht-Owner', async () => {
    authMocks.requireHouseholdOwner.mockRejectedValue(forbidden)
    await expect(introductionGet(event('GET', undefined, { url: '/x?date=2026-11-20' }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('POST /accounts', () => {
  it('parst Konto und Startdatum', async () => {
    await accountsPost(event('POST', { name: 'Sparschwein', type: 'CASH', openingBalance: '35', startDate: '2027-02-01' }))
    expect(accountMocks.createAccount).toHaveBeenCalledWith(HH_ID, {
      name: 'Sparschwein', type: 'CASH', openingBalance: 3500, startDate: new Date(2027, 1, 1, 12, 0, 0, 0),
    })
  })

  it('400 ohne Startdatum', async () => {
    await expect(accountsPost(event('POST', { name: 'Sparschwein', type: 'CASH' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('PATCH und DELETE /accounts/:id', () => {
  it('reicht nur angegebene Felder weiter, closedAt null oeffnet wieder', async () => {
    await accountPatch(event('PATCH', { name: ' Bargeld ', closedAt: null }, { id: ACCOUNT_ID }))
    expect(accountMocks.updateAccount).toHaveBeenCalledWith(HH_ID, ACCOUNT_ID, { name: 'Bargeld', closedAt: null })

    await accountPatch(event('PATCH', { closedAt: '2026-12-01', openingBalance: 100 }, { id: ACCOUNT_ID }))
    expect(accountMocks.updateAccount).toHaveBeenLastCalledWith(HH_ID, ACCOUNT_ID, { openingBalance: 10000, closedAt: new Date(2026, 11, 1, 12, 0, 0, 0) })
  })

  it('400 ohne Aenderung oder mit leerem Namen', async () => {
    await expect(accountPatch(event('PATCH', {}, { id: ACCOUNT_ID }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(accountPatch(event('PATCH', { name: '' }, { id: ACCOUNT_ID }))).rejects.toMatchObject({ statusCode: 400 })
    expect(accountMocks.updateAccount).not.toHaveBeenCalled()
  })

  it('DELETE nimmt die ID aus dem Path', async () => {
    await expect(accountDelete(event('DELETE', undefined, { id: ACCOUNT_ID }))).resolves.toEqual({ data: { kind: 'account', deleted: true } })
    expect(accountMocks.deleteAccount).toHaveBeenCalledWith(HH_ID, ACCOUNT_ID)
  })

  it('400 fuer eine ID, die keine UUID ist, 403 fuer Nicht-Owner', async () => {
    await expect(accountDelete(event('DELETE', undefined, { id: 'nope' }))).rejects.toMatchObject({ statusCode: 400 })
    authMocks.requireHouseholdOwner.mockRejectedValue(forbidden)
    await expect(accountDelete(event('DELETE', undefined, { id: ACCOUNT_ID }))).rejects.toMatchObject({ statusCode: 403 })
    expect(accountMocks.deleteAccount).not.toHaveBeenCalled()
  })
})
