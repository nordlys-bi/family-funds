/*
 * Tests fuer die Onboarding-Tour-Endpoints (issue #16):
 *
 *   GET  /api/user/onboarding
 *   PATCH /api/user/onboarding
 *   GET  /api/households/:householdId/activity
 *
 * Coverage:
 *  - GET liefert Defaults wenn User-Defaults nicht gesetzt
 *  - PATCH persistiert completedSteps + skipped
 *  - PATCH whitelistet nur erlaubte Step-IDs (Client-Injection-Schutz)
 *  - PATCH wirft 400 wenn weder completedSteps noch skipped gegeben
 *  - Activity-Endpoint zaehlt Member/Budget/Transaktion parallel
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

const prismaMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  householdMember: { count: vi.fn() },
  budget: { count: vi.fn() },
  expenseTransaction: { count: vi.fn() },
}))

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
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

vi.mock('../../../utils/prisma', () => ({ prisma: prismaMocks }))
vi.mock('../../../utils/household-access', () => ({
  requireAuthenticatedUser: authMocks.requireAuthenticatedUser,
  requireHouseholdMembership: authMocks.requireHouseholdMembership,
}))

function setRequestBody(body: any) {
  readBodyMock.mockResolvedValueOnce(body)
}

import onboardingGetHandler from '../onboarding.get'
import onboardingPatchHandler from '../onboarding.patch'
import activityHandler from '../../households/[householdId]/activity.get'

const USER_ID = 'u-1'

function makeEvent(body?: any): H3Event {
  const event = {
    context: { params: {}, user: null },
    node: { req: { headers: {} }, res: {} },
  } as unknown as H3Event

  if (body !== undefined) {
    // h3's readBody liest aus event._requestBody oder einer Mock-Source.
    // Wir mocken ueber einen dynamic-import-Pfad oder direkt am Event.
    ;(event as any)._requestBody = body
  }

  return event
}

function mockAuthUser() {
  authMocks.requireAuthenticatedUser.mockResolvedValue({
    id: USER_ID,
    email: 'jan@example.com',
  })
}

function mockAuthMembership() {
  authMocks.requireHouseholdMembership.mockResolvedValue({
    user: { id: USER_ID },
    membership: { id: 'm-1', role: 'MEMBER' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/user/onboarding', () => {
  it('liefert die Defaults wenn keine Row gefunden', async () => {
    mockAuthUser()
    prismaMocks.user.findUnique.mockResolvedValue(null)

    const response = await onboardingGetHandler(makeEvent())

    expect(response).toEqual({
      data: { completedSteps: [], skipped: false },
    })
  })

  it('liefert die persistierten Werte', async () => {
    mockAuthUser()
    prismaMocks.user.findUnique.mockResolvedValue({
      onboardingCompletedSteps: ['household', 'invite'],
      onboardingSkipped: true,
    })

    const response = await onboardingGetHandler(makeEvent())

    expect(response).toEqual({
      data: { completedSteps: ['household', 'invite'], skipped: true },
    })
  })
})

describe('PATCH /api/user/onboarding', () => {
  it('persistiert completedSteps', async () => {
    mockAuthUser()
    prismaMocks.user.update.mockResolvedValue({
      onboardingCompletedSteps: ['household'],
      onboardingSkipped: false,
    })
    setRequestBody({ completedSteps: ['household'] })

    const response = await onboardingPatchHandler(makeEvent())

    expect(response).toEqual({
      data: { completedSteps: ['household'], skipped: false },
    })
    expect(prismaMocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ onboardingCompletedSteps: ['household'] }),
      }),
    )
  })

  it('persistiert skipped=true', async () => {
    mockAuthUser()
    prismaMocks.user.update.mockResolvedValue({
      onboardingCompletedSteps: [],
      onboardingSkipped: true,
    })
    setRequestBody({ skipped: true })

    const response = await onboardingPatchHandler(makeEvent())

    expect(response).toEqual({
      data: { completedSteps: [], skipped: true },
    })
  })

  it('filtert nicht-Whitelist-Step-IDs raus (Client-Injection-Schutz)', async () => {
    mockAuthUser()
    prismaMocks.user.update.mockResolvedValue({
      onboardingCompletedSteps: ['household'],
      onboardingSkipped: false,
    })
    setRequestBody({ completedSteps: ['household', 'evil-step', '../../../etc/passwd'] })

    await onboardingPatchHandler(makeEvent())

    expect(prismaMocks.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ onboardingCompletedSteps: ['household'] }),
      }),
    )
  })

  it('wirft 400 wenn weder completedSteps noch skipped gegeben', async () => {
    mockAuthUser()
    setRequestBody({ otherField: 'x' })

    await expect(onboardingPatchHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe('GET /api/households/:id/activity', () => {
  it('liefert die Counts parallel', async () => {
    mockAuthMembership()
    prismaMocks.householdMember.count.mockResolvedValue(2)
    prismaMocks.budget.count.mockResolvedValue(3)
    prismaMocks.expenseTransaction.count.mockResolvedValue(15)

    const event = {
      context: { params: { householdId: '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab' } },
    } as unknown as H3Event

    const response = await activityHandler(event)

    expect(response).toEqual({
      data: { memberCount: 2, budgetCount: 3, transactionCount: 15 },
    })
  })

  it('rejected bei fehlender Membership mit 403', async () => {
    authMocks.requireHouseholdMembership.mockRejectedValue({
      statusCode: 403,
      statusMessage: 'You do not have access to this household.',
    })

    const event = {
      context: { params: { householdId: '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab' } },
    } as unknown as H3Event

    await expect(activityHandler(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})