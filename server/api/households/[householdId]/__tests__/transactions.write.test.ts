/*
 * Endpoint-Tests fuer das Schreiben von Ausgaben und Einnahmen (issue #181):
 * nur Auth und Parsen. Die fachlichen Regeln (Umschlag vom Plan, Stichtag,
 * Soft-Delete, Restore) testet server/utils/__tests__/transactions.test.ts
 * gegen den In-Memory-Adapter; hier sind die vier Funktionen gemockt.
 *
 * h3's readBody liest `event.node.req.body`, wenn dort bereits ein Objekt
 * steht.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@prisma/client'
import type { H3Event } from 'h3'

const writeMocks = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))
vi.mock('../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))
vi.mock('../../../../utils/transactions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/transactions')>()),
  ...writeMocks,
}))

import postHandler from '../transactions.post'
import patchHandler from '../transactions.patch'
import deleteExpenseHandler from '../expenses/[id].delete'
import deleteIncomeHandler from '../incomes/[id].delete'
import restoreExpenseHandler from '../expenses/[id]/restore.post'
import restoreIncomeHandler from '../incomes/[id]/restore.post'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const TX_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function bodyEvent(method: string, body: Record<string, unknown>): H3Event {
  return {
    context: { params: { householdId: HH_ID } },
    method,
    node: {
      req: { url: '', headers: { 'content-type': 'application/json' }, method, body },
      res: {},
    },
  } as unknown as H3Event
}

function pathEvent(id = TX_ID, householdId = HH_ID): H3Event {
  return { context: { params: { householdId, id } } } as unknown as H3Event
}

const forbidden = { statusCode: 403, statusMessage: 'You do not have access to this household.' }

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: 'user-1' },
    membership: { id: 'm-1', role: Role.MEMBER },
  })
  writeMocks.createTransaction.mockResolvedValue({ id: 'tx-new' })
  writeMocks.updateTransaction.mockResolvedValue({ id: TX_ID })
  writeMocks.deleteTransaction.mockResolvedValue(undefined)
  writeMocks.restoreTransaction.mockResolvedValue({ alreadyActive: false })
})

describe('POST /transactions', () => {
  it('parst Betrag, Datum und Texte und antwortet im Envelope', async () => {
    const response = await postHandler(bodyEvent('POST', {
      kind: 'income', amount: '25,50', date: '2026-11-03', description: '  Gehalt ', envelopeId: ' env-1 ', accountId: ' giro ',
    }))

    expect(writeMocks.createTransaction).toHaveBeenCalledWith(HH_ID, 'user-1', 'income', {
      amount: 2550,
      date: new Date(2026, 10, 3, 12, 0, 0, 0),
      description: 'Gehalt',
      envelopeId: 'env-1',
      planId: null,
      accountId: 'giro',
    })
    expect(response).toEqual({ data: { kind: 'income', item: { id: 'tx-new' } } })
  })

  it('leere Felder werden null ("Zu verteilen", keine Notiz)', async () => {
    await postHandler(bodyEvent('POST', { kind: 'expense', amount: 10, date: '2026-11-03', description: ' ', envelopeId: '', accountId: '' }))

    expect(writeMocks.createTransaction.mock.lastCall![3]).toMatchObject({ description: null, envelopeId: null, planId: null, accountId: null })
  })

  it.each([
    ['expense', { fixedCostPlanId: 'fc-1', incomePlanId: 'ip-1' }, 'fc-1'],
    ['income', { fixedCostPlanId: 'fc-1', incomePlanId: 'ip-1' }, 'ip-1'],
  ])('nimmt fuer %s nur den passenden Plan', async (kind, plans, planId) => {
    await postHandler(bodyEvent('POST', { kind, amount: 10, date: '2026-11-03', ...plans }))

    expect(writeMocks.createTransaction.mock.lastCall![3].planId).toBe(planId)
  })

  it('reicht kein budgetId mehr durch (issue #105)', async () => {
    await postHandler(bodyEvent('POST', { kind: 'income', amount: 10, date: '2026-11-03', budgetId: 'b-1' }))

    expect(writeMocks.createTransaction.mock.lastCall![3]).not.toHaveProperty('budgetId')
  })

  it.each([
    ['ohne Betrag', { kind: 'expense', date: '2026-11-03' }],
    ['ohne Datum', { kind: 'expense', amount: 10 }],
    ['mit unbekannter Art', { kind: 'transfer', amount: 10, date: '2026-11-03' }],
    ['mit ungueltigem Betrag', { kind: 'expense', amount: 'viel', date: '2026-11-03' }],
  ])('400 %s', async (_name, body) => {
    await expect(postHandler(bodyEvent('POST', body))).rejects.toMatchObject({ statusCode: 400 })
    expect(writeMocks.createTransaction).not.toHaveBeenCalled()
  })

  it('403 fuer Nicht-Mitglieder', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue(forbidden)

    await expect(postHandler(bodyEvent('POST', { kind: 'expense', amount: 10, date: '2026-11-03' }))).rejects.toMatchObject({ statusCode: 403 })
    expect(writeMocks.createTransaction).not.toHaveBeenCalled()
  })
})

describe('PATCH /transactions', () => {
  it('reicht nur angegebene Felder weiter', async () => {
    const response = await patchHandler(bodyEvent('PATCH', { kind: 'expense', id: TX_ID, amount: 12 }))

    expect(writeMocks.updateTransaction).toHaveBeenCalledWith(HH_ID, 'expense', TX_ID, {
      amount: 1200,
      date: undefined,
      description: undefined,
      envelopeId: undefined,
      accountId: undefined,
    })
    expect(response).toEqual({ data: { kind: 'expense', item: { id: TX_ID } } })
  })

  it('unterscheidet "Umschlag nicht geaendert" von "Zu verteilen"', async () => {
    await patchHandler(bodyEvent('PATCH', { kind: 'income', id: TX_ID, envelopeId: null, description: null }))

    expect(writeMocks.updateTransaction.mock.lastCall![3]).toMatchObject({ envelopeId: null, description: null })
  })

  it('unterscheidet "Konto nicht geaendert" von "kein Konto"', async () => {
    await patchHandler(bodyEvent('PATCH', { kind: 'expense', id: TX_ID, accountId: ' cash ' }))
    expect(writeMocks.updateTransaction.mock.lastCall![3]).toMatchObject({ accountId: 'cash' })

    await patchHandler(bodyEvent('PATCH', { kind: 'expense', id: TX_ID, accountId: null }))
    expect(writeMocks.updateTransaction.mock.lastCall![3]).toMatchObject({ accountId: null })
  })

  it.each([
    ['ohne ID', { kind: 'expense', amount: 10 }],
    ['mit unbekannter Art', { kind: 'transfer', id: TX_ID }],
  ])('400 %s', async (_name, body) => {
    await expect(patchHandler(bodyEvent('PATCH', body))).rejects.toMatchObject({ statusCode: 400 })
    expect(writeMocks.updateTransaction).not.toHaveBeenCalled()
  })

  it('403 fuer Nicht-Mitglieder', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue(forbidden)

    await expect(patchHandler(bodyEvent('PATCH', { kind: 'expense', id: TX_ID }))).rejects.toMatchObject({ statusCode: 403 })
    expect(writeMocks.updateTransaction).not.toHaveBeenCalled()
  })
})

describe.each([
  ['expense', deleteExpenseHandler, restoreExpenseHandler],
  ['income', deleteIncomeHandler, restoreIncomeHandler],
] as const)('DELETE und Restore (%s)', (kind, deleteHandler, restoreHandler) => {
  it('DELETE nimmt die ID aus dem Path', async () => {
    await expect(deleteHandler(pathEvent())).resolves.toEqual({ data: { kind, deleted: true } })
    expect(writeMocks.deleteTransaction).toHaveBeenCalledWith(HH_ID, kind, TX_ID)
  })

  it('Restore meldet, ob die Buchung schon aktiv war', async () => {
    await expect(restoreHandler(pathEvent())).resolves.toEqual({ data: { kind, restored: true } })
    expect(writeMocks.restoreTransaction).toHaveBeenCalledWith(HH_ID, kind, TX_ID)

    writeMocks.restoreTransaction.mockResolvedValue({ alreadyActive: true })
    await expect(restoreHandler(pathEvent())).resolves.toEqual({ data: { kind, restored: true, alreadyActive: true } })
  })

  it('400 fuer eine ID, die keine UUID ist', async () => {
    await expect(deleteHandler(pathEvent('not-a-uuid'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(restoreHandler(pathEvent('not-a-uuid'))).rejects.toMatchObject({ statusCode: 400 })
    expect(writeMocks.deleteTransaction).not.toHaveBeenCalled()
    expect(writeMocks.restoreTransaction).not.toHaveBeenCalled()
  })

  it('403 fuer Nicht-Mitglieder', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue(forbidden)

    await expect(deleteHandler(pathEvent())).rejects.toMatchObject({ statusCode: 403 })
    await expect(restoreHandler(pathEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(writeMocks.deleteTransaction).not.toHaveBeenCalled()
    expect(writeMocks.restoreTransaction).not.toHaveBeenCalled()
  })
})
