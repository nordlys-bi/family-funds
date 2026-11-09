/*
 * Tests fuer `POST`/`PATCH .../planning`: Auth und Parsen des Bodys. Die Regeln
 * dahinter testet `server/utils/__tests__/envelope-planning.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const planningMocks = vi.hoisted(() => ({ createPlan: vi.fn(), updatePlan: vi.fn() }))
const authMocks = vi.hoisted(() => ({ requireHouseholdOwner: vi.fn() }))

vi.mock('../../../../utils/envelope-planning', () => planningMocks)
vi.mock('../../../../utils/household-access', () => authMocks)
vi.mock('../../../../utils/prisma', () => ({ prisma: {} }))

import createHandler from '../planning.post'
import updateHandler from '../planning.patch'

const HH_ID = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
const body = { kind: 'fixedCostPlan', name: ' Miete ', amount: '950', frequency: 'MONTHLY', startDate: '2026-11-01', endDate: null }

function makeEvent(payload: Record<string, unknown>): H3Event {
  return {
    context: { params: { householdId: HH_ID } },
    method: 'POST',
    node: { req: { url: '', headers: { 'content-type': 'application/json' }, method: 'POST', body: payload }, res: {} },
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  planningMocks.createPlan.mockResolvedValue({ id: 'plan' })
  planningMocks.updatePlan.mockResolvedValue({ id: 'plan' })
})

describe('POST /planning', () => {
  it('passes parsed values on and wraps the response', async () => {
    const response = await createHandler(makeEvent({ ...body, envelopeId: ' env ' }))
    expect(authMocks.requireHouseholdOwner).toHaveBeenCalled()
    expect(planningMocks.createPlan).toHaveBeenCalledWith(HH_ID, 'fixedCostPlan', {
      name: 'Miete',
      amount: 95000,
      frequency: 'MONTHLY',
      startDate: new Date('2026-11-01T12:00:00'),
      endDate: null,
      envelopeId: 'env',
    })
    expect(response).toEqual({ data: { kind: 'fixedCostPlan', item: { id: 'plan' } } })
  })

  it.each([[undefined], [null], ['']])('treats envelopeId %j as no envelope', async (envelopeId) => {
    await createHandler(makeEvent({ ...body, envelopeId }))
    expect(planningMocks.createPlan.mock.calls[0]![2].envelopeId).toBeNull()
  })

  it.each([
    ['kind', { kind: 'budget' }],
    ['name', { name: '  ' }],
    ['amount', { amount: '-5' }],
    ['frequency', { frequency: 'DAILY' }],
    ['startDate', { startDate: undefined }],
    ['envelopeId', { envelopeId: 5 }],
  ])('rejects an invalid %s', async (_name, change) => {
    await expect(createHandler(makeEvent({ ...body, ...change }))).rejects.toMatchObject({ statusCode: 400 })
    expect(planningMocks.createPlan).not.toHaveBeenCalled()
  })
})

describe('PATCH /planning', () => {
  it('passes only what the body contains', async () => {
    await updateHandler(makeEvent({ kind: 'incomePlan', id: 'plan', name: 'Gehalt' }))
    const changes = planningMocks.updatePlan.mock.calls[0]![3]
    expect(planningMocks.updatePlan.mock.calls[0]!.slice(0, 3)).toEqual([HH_ID, 'incomePlan', 'plan'])
    expect(changes).toEqual({ name: 'Gehalt', envelopeId: undefined })
  })

  it('distinguishes "no envelope" from "unchanged"', async () => {
    await updateHandler(makeEvent({ kind: 'incomePlan', id: 'plan', envelopeId: null }))
    expect(planningMocks.updatePlan.mock.calls[0]![3].envelopeId).toBeNull()
  })

  it('clears the end date with an explicit null', async () => {
    await updateHandler(makeEvent({ kind: 'fixedCostPlan', id: 'plan', endDate: null }))
    expect(planningMocks.updatePlan.mock.calls[0]![3].endDate).toBeNull()
  })

  it('requires an id', async () => {
    await expect(updateHandler(makeEvent({ kind: 'fixedCostPlan' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
