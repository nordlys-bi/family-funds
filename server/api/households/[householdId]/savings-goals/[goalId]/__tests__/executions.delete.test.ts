/*
 * Tests fuer DELETE /api/households/:householdId/savings-goals/:goalId/executions/:execId
 *
 * Issue #41: Berechtigung wurde auf MEMBER (also `requireHouseholdMembership`)
 * gelockert, damit Members ihre eigenen Spar-Executions zuruecknehmen koennen.
 * Vorher stand der Endpoint auf `requireHouseholdOwner` — asymmetrisch zum
 * korrespondierenden POST-Endpoint (Issue #36). Argument analog zu
 * `server/api/households/[householdId]/expenses/[id].delete.ts:22`
 * ("Members duerfen loeschen, weil sie auch Transaktionen anlegen duerfen.").
 *
 * Was getestet wird:
 *  - Happy-Path: MEMBER loescht eine bestehende Execution erfolgreich.
 *  - Happy-Path: OWNER loescht ebenfalls (Regression-Schutz fuer den Owner-Pfad).
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
  savingsGoalExecution: { findFirst: vi.fn(), delete: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireHouseholdMembership: vi.fn(),
}))

vi.mock('../../../../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../../../../utils/household-access', () => ({
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

import handler from '../executions/[execId].delete'

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

describe('DELETE /households/:id/savings-goals/:goalId/executions/:execId — Issue #41', () => {
  it('laesst MEMBER eine bestehende Execution loeschen', async () => {
    mockMember()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue({ id: EXEC_ID })
    prismaMocks.savingsGoalExecution.delete.mockResolvedValue({ id: EXEC_ID })

    const response = await handler(makeEvent())

    expect(response).toEqual({
      data: { kind: 'execution', deleted: true },
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
    expect(prismaMocks.savingsGoalExecution.delete).toHaveBeenCalledWith({
      where: { id: EXEC_ID },
    })
  })

  it('laesst OWNER ebenfalls loeschen (Regression-Schutz fuer den Owner-Pfad)', async () => {
    mockOwner()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue({ id: EXEC_ID })
    prismaMocks.savingsGoalExecution.delete.mockResolvedValue({ id: EXEC_ID })

    const response = await handler(makeEvent())

    expect(response.data).toEqual({ kind: 'execution', deleted: true })
    expect(authMocks.requireHouseholdMembership).toHaveBeenCalledOnce()
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
    expect(prismaMocks.savingsGoalExecution.delete).not.toHaveBeenCalled()
  })

  it('wirft 404 wenn die Execution nicht zum (goal, household) gehoert', async () => {
    mockMember()
    prismaMocks.savingsGoalExecution.findFirst.mockResolvedValue(null)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('Execution not found'),
    })
    expect(prismaMocks.savingsGoalExecution.delete).not.toHaveBeenCalled()
  })

  it('wirft 400 bei ungueltiger UUID', async () => {
    mockMember()
    await expect(
      handler(makeEvent(HH_ID, GOAL_ID, 'not-a-uuid')),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMocks.savingsGoalExecution.findFirst).not.toHaveBeenCalled()
  })
})
