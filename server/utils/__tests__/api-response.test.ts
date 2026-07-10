/*
 * Unit-Tests fuer `defineApiResponse` (issue #27 Finding B).
 *
 * Der Helper wickelt Daten in `{ data, meta? }` ein. Meta ist optional —
 * ohne Meta wird das Feld komplett weggelassen (kein `meta: undefined`,
 * weil das Frontend sonst `data.meta === undefined` als "nicht vorhanden"
 * vs. "explizit leer" unterscheiden müsste).
 */
import { describe, expect, it } from 'vitest'
import { defineApiResponse } from '../api-response'

describe('defineApiResponse', () => {
  it('wickelt Daten in `{ data: T }` ein, ohne Meta-Feld', () => {
    const result = defineApiResponse({ kind: 'budget', item: { id: '1' } })

    expect(result).toEqual({ data: { kind: 'budget', item: { id: '1' } } })
    expect(result).not.toHaveProperty('meta')
  })

  it('optional: nimmt explizit uebergebenes Meta auf', () => {
    const result = defineApiResponse({ success: true }, { warning: 'soft delete' })

    expect(result).toEqual({
      data: { success: true },
      meta: { warning: 'soft delete' },
    })
  })

  it('typ-sicher: number data, string data, void-Arrays', () => {
    expect(defineApiResponse(42)).toEqual({ data: 42 })
    expect(defineApiResponse('ok')).toEqual({ data: 'ok' })
    expect(defineApiResponse([])).toEqual({ data: [] })
    expect(defineApiResponse(null)).toEqual({ data: null })
  })

  it('unterscheidet explizit von "meta weggelassen" vs. "meta = {}"', () => {
    const withoutMeta = defineApiResponse({ x: 1 })
    const withEmptyMeta = defineApiResponse({ x: 1 }, {})

    expect('meta' in withoutMeta).toBe(false)
    expect('meta' in withEmptyMeta).toBe(true)
    expect(withEmptyMeta.meta).toEqual({})
  })
})