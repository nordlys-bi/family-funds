/*
 * Tests fuer POST /api/households/:householdId/savings-goals/:goalId/executions
 *
 * Issue #36: Berechtigung wurde auf MEMBER (also `requireHouseholdMembership`)
 * gelockert, damit Members Spar-Executions buchen koennen. Vorher stand der
 * Endpoint auf `requireHouseholdOwner` — fachlicher Bruch, weil Members
 * Ausgaben buchen duerfen, aber keine Spar-Execution.
 *
 * Was getestet wird:
 *  - Happy-Path: MEMBER bucht eine positive Execution (Einzahlung) erfolgreich.
 *  - Happy-Path: MEMBER bucht eine negative Execution (Entnahme) erfolgreich.
 *  - Happy-Path: OWNER bucht ebenfalls (Regression-Schutz fuer den Owner-Pfad).
 *  - 403 wenn der User nicht im Haushalt ist.
 *  - 404 wenn der Goal nicht zum Household gehoert (cross-household-Schutz).
 *  - 400 bei ungueltiger UUID.
 *
 * Pattern-Vorlage: server/api/user/__tests__/onboarding.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  savingsGoal: { findFirst: vi.fn() },
  savingsGoalExecution: { create: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

// h3 readBody mocken — wir setzen den Mock per Test in `setRequestBody`.
const readBodyMock = vi.hoisted(() => vi.fn())
vi.mock('h3', async (importActual) => {
  const actual = await importActual<typeof import('h3')>()
  return {
    ...actual,
    readBody: readBodyMock,
  }
})

vi.mock('../../../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

function setRequestBody(body: unknown) {
  readBodyMock.mockResolvedValueOnce(body)
}

import handler from '../executions.post'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'user-member-1'

function makeEvent(householdId = HH_ID, goalId = GOAL_ID): H3Event {
  return {
    context: { params: { householdId, goalId } },
  } as unknown as H3Event
}

function mockMember() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: USER_ID, oidcSubject: 'mock_user_member', email: 'm@h.de', displayName: 'M' },
    membership: { id: 'm-1', userId: USER_ID, householdId: HH_ID, role: 'MEMBER' },
  })
}

function mockOwner() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: USER_ID, oidcSubject: 'mock_user_owner', email: 'o@h.de', displayName: 'O' },
    membership: { id: 'm-1', userId: USER_ID, householdId: HH_ID, role: 'OWNER' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /households/:id/savings-goals/:goalId/executions — Issue #36', () => {
  it('laesst MEMBER eine positive Execution (Einzahlung) buchen', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: 50 })
    prismaMocks.savingsGoalExecution.create.mockResolvedValue({
      id: 'exec-1',
      savingsGoalId: GOAL_ID,
      amount: 5000,
      date: new Date(),
    })

    const response = await handler(makeEvent())

    expect(response).toEqual({
      data: {
        kind: 'execution',
        item: expect.objectContaining({ id: 'exec-1', amount: 5000 }),
      },
    })
    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledOnce()
    expect(prismaMocks.savingsGoalExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        savingsGoalId: GOAL_ID,
        amount: 5000, // EUR 50,00 in Cent
      }),
    })
  })

  it('laesst MEMBER eine negative Execution (Entnahme) buchen', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: -25 })
    prismaMocks.savingsGoalExecution.create.mockResolvedValue({
      id: 'exec-2',
      savingsGoalId: GOAL_ID,
      amount: -2500,
      date: new Date(),
    })

    const response = await handler(makeEvent())

    expect(response.data.kind).toBe('execution')
    expect(response.data.item.amount).toBe(-2500)
    expect(prismaMocks.savingsGoalExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -2500 }),
    })
  })

  it('laesst OWNER ebenfalls buchen (Regression-Schutz fuer Owner-Pfad)', async () => {
    mockOwner()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: 10 })
    prismaMocks.savingsGoalExecution.create.mockResolvedValue({
      id: 'exec-3',
      savingsGoalId: GOAL_ID,
      amount: 1000,
      date: new Date(),
    })

    const response = await handler(makeEvent())

    expect(response.data.kind).toBe('execution')
  })

  it('speichert eine optionale Notiz im note-Feld (issue #38)', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: 50, note: 'Urlaubssparen Q3' })
    prismaMocks.savingsGoalExecution.create.mockResolvedValue({
      id: 'exec-4',
      savingsGoalId: GOAL_ID,
      amount: 5000,
      date: new Date(),
      note: 'Urlaubssparen Q3',
    })

    await handler(makeEvent())

    expect(prismaMocks.savingsGoalExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        savingsGoalId: GOAL_ID,
        amount: 5000,
        note: 'Urlaubssparen Q3',
      }),
    })
  })

  it('normalisiert leere Notiz zu null', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: 10, note: '   ' })
    prismaMocks.savingsGoalExecution.create.mockResolvedValue({
      id: 'exec-5',
      savingsGoalId: GOAL_ID,
      amount: 1000,
      date: new Date(),
      note: null,
    })

    await handler(makeEvent())

    expect(prismaMocks.savingsGoalExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 1000,
        note: null,
      }),
    })
  })

  it('lehnt Notiz ueber 500 Zeichen mit 400 ab', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue({ id: GOAL_ID })
    setRequestBody({ amount: 10, note: 'x'.repeat(501) })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('500 characters'),
    })
    expect(prismaMocks.savingsGoalExecution.create).not.toHaveBeenCalled()
  })

  it('lehnt nicht-Mitglieder mit 403 ab (Auth bleibt geschuetzt)', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 403,
    })
    // Wichtig: kein Prisma-Lookup bei abgelehntem Auth.
    expect(prismaMocks.savingsGoal.findFirst).not.toHaveBeenCalled()
    expect(prismaMocks.savingsGoalExecution.create).not.toHaveBeenCalled()
  })

  it('wirft 404 wenn der Goal nicht zum Household gehoert (cross-household-Schutz)', async () => {
    mockMember()
    prismaMocks.savingsGoal.findFirst.mockResolvedValue(null)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('Savings goal not found'),
    })
    expect(prismaMocks.savingsGoalExecution.create).not.toHaveBeenCalled()
  })

  it('wirft 400 bei ungueltiger UUID', async () => {
    mockMember()
    await expect(
      handler(makeEvent(HH_ID, 'not-a-uuid')),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
