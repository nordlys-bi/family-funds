import { describe, expect, it } from 'vitest'
import { createError, type H3Event } from 'h3'
import { parseUuidParam } from '../validation'

/**
 * Minimaler Fake für das, was `parseUuidParam` aus `event` liest:
 * `getRouterParam(event, name)`. h3's getRouterParam liest aus
 * `event.context.params`. Wir bauen den Event mit genau diesem Field auf.
 */
function makeEvent(params: Record<string, string | undefined> | null): H3Event {
  return {
    context: { params: params ?? {} },
  } as unknown as H3Event
}

describe('parseUuidParam', () => {
  it('returns the value for a valid v4 UUID', () => {
    const uuid = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const event = makeEvent({ householdId: uuid })
    expect(parseUuidParam(event, 'householdId')).toBe(uuid)
  })

  it('also accepts uppercase hex (Prisma accepts both)', () => {
    const uuid = '9BFF8D9F-7D2E-4F1A-B3C8-1234567890AB'
    const event = makeEvent({ id: uuid })
    expect(parseUuidParam(event, 'id')).toBe(uuid)
  })

  it('throws 400 when the param is missing', () => {
    const event = makeEvent({})
    expect(() => parseUuidParam(event, 'householdId')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('throws 400 when the param is not a UUID at all', () => {
    const event = makeEvent({ householdId: 'abc' })
    expect(() => parseUuidParam(event, 'householdId')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('throws 400 when the UUID is malformed (too short)', () => {
    const event = makeEvent({ id: '9bff8d9f-7d2e-4f1a-b3c8' })
    expect(() => parseUuidParam(event, 'id')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('throws 400 for typical injection attempts', () => {
    const event = makeEvent({ id: "'; DROP TABLE households; --" })
    expect(() => parseUuidParam(event, 'id')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('error message references the param name for debuggability', () => {
    try {
      parseUuidParam(makeEvent({}), 'membershipId')
      throw new Error('should have thrown')
    } catch (err) {
      const e = err as ReturnType<typeof createError>
      expect(e.statusCode).toBe(400)
      expect(e.statusMessage).toContain('membershipId')
    }
  })
})
