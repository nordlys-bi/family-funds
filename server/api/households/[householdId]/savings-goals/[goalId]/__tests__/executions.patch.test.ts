/*
 * Tests fuer PATCH /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Issue #41: Berechtigung wurde auf MEMBER (also `requireHouseholdMembership`)
 * gelockert, damit Members ihre eigenen Spar-Executions korrigieren koennen.
 * Vorher stand der Endpoint auf `requireHouseholdOwner` — asymmetrisch zum
 * korrespondierenden POST-Endpoint (Issue #36) und ein faktischer
 * Buchungs-Hoheit-Verlust fuer Members.
 *
 * Was getestet wird:
 *  - Happy-Path: MEMBER patcht eine bestehende Execution (amount + date) erfolgreich.
 *  - Happy-Path: OWNER patcht ebenfalls (Regression-Schutz fuer den Owner-Pfad).
 *  - Patch ohne Body-Felder (leerer Body) loest kein Update aus, returnt aber
 *    die bestehende Row.
 *  - 403 wenn der User nicht im Haushalt ist.
 *  - 404 wenn die Execution nicht zum (goal, household) gehoert.
 *  - 400 bei ungueltiger UUID.
 *
 * Pattern-Vorlage: server/api/households/[householdId]/savings-goals/[goalId]/
 *                  __tests__/executions.post.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  savingsGoalExecution: { findFirst: vi.fn(), update: vi.fn() },
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

import handler from '../executions/[execId].patch'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const GOAL_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const EXEC_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const USER_ID = 'user-member-1'

function makeEvent(
  householdId = HH_ID,
  goalId = GOAL_ID,
  execId = EXEC_ID,
): H3Event {
  return {
    context: { params: { householdId, goalId, execId } },
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

describe('PATCH /households/:id/savings-goals/:goalId/executions/:execId — Issue #41', () => {
  it('laesst MEMBER eine bestehende Execution patchen (amount + date)', async () => {
    mockMember()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue({ id: EXEC_ID })
    setRequestBody({ amount: 75, date: '2026-07-15' })
    prismaMocks.savingsGoalExecution.update.mockResolvedValue({
      id: EXEC_ID,
      savingsGoalId: GOAL_ID,
      amount: 7500,
      date: new Date('2026-07-15T00:00:00'),
    })

    const response = await handler(makeEvent())

    expect(response).toEqual({
      data: {
        kind: 'execution',
        item: expect.objectContaining({ id: EXEC_ID, amount: 7500 }),
      },
    })
    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledOnce()
    expect(prismaMocks.savingsGoalExecution.findFirst).toHaveBeenCalledWith({
      where: {
        id: EXEC_ID,
        savingsGoalId: GOAL_ID,
        savingsGoal: { householdId: HH_ID },
      },
      select: { id: true },
    })
    expect(prismaMocks.savingsGoalExecution.update).toHaveBeenCalledWith({
      where: { id: EXEC_ID },
      data: expect.objectContaining({
        amount: 7500, // EUR 75,00 in Cent
      }),
    })
  })

  it('laesst OWNER ebenfalls patchen (Regression-Schutz fuer den Owner-Pfad)', async () => {
    mockOwner()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue({ id: EXEC_ID })
    setRequestBody({ amount: 100 })
    prismaMocks.savingsGoalExecution.update.mockResolvedValue({
      id: EXEC_ID,
      savingsGoalId: GOAL_ID,
      amount: 10000,
      date: new Date(),
    })

    const response = await handler(makeEvent())

    expect(response.data.kind).toBe('execution')
    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledOnce()
  })

  it('laesst MEMBER nur amount patchen (date bleibt unveraendert)', async () => {
    mockMember()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue({ id: EXEC_ID })
    setRequestBody({ amount: -25 })
    prismaMocks.savingsGoalExecution.update.mockResolvedValue({
      id: EXEC_ID,
      savingsGoalId: GOAL_ID,
      amount: -2500,
      date: new Date('2026-01-01T00:00:00'),
    })

    const response = await handler(makeEvent())

    expect(response.data.item.amount).toBe(-2500)
    // Nur amount, kein date — Date-Key fehlt im data-Objekt.
    const updateCall = prismaMocks.savingsGoalExecution.update.mock.calls[0][0]
    expect(updateCall.data).toEqual({ amount: -2500 })
    expect(updateCall.data.date).toBeUndefined()
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
    expect(prismaMocks.savingsGoalExecution.findFirst).not.toHaveBeenCalled()
    expect(prismaMocks.savingsGoalExecution.update).not.toHaveBeenCalled()
  })

  it('wirft 404 wenn die Execution nicht zum (goal, household) gehoert', async () => {
    mockMember()
    // findFirst liefert null — Execution existiert nicht im erwarteten Scope.
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue(null)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('Execution not found'),
    })
    expect(prismaMocks.savingsGoalExecution.update).not.toHaveBeenCalled()
  })

  it('wirft 400 bei ungueltiger UUID', async () => {
    mockMember()
    await expect(
      handler(makeEvent(HH_ID, GOAL_ID, 'not-a-uuid')),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.savingsGoalExecution.findFirst).not.toHaveBeenCalled()
  })
})
