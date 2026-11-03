import { describe, expect, it } from 'vitest'
import { ENVELOPE_GROUPS, envelopesBookableOn, isBeforeLedger, isEnvelopeBookableOn, isEnvelopeGroup, isEnvelopeOpenOn, sortEnvelopes, type EnvelopeOption } from '../envelope-options'

const envelope = (id: string, overrides: Partial<EnvelopeOption> = {}): EnvelopeOption => ({
  id, name: id, group: 'RUNNING', balanceSince: new Date(2026, 8, 1, 12), closedAt: null, ...overrides,
})

describe('isEnvelopeBookableOn', () => {
  it('accepts days from the start up to, but not including, the closing date', () => {
    const closed = envelope('a', { closedAt: new Date(2026, 9, 5, 12) })
    expect(isEnvelopeBookableOn(closed, '2026-08-31')).toBe(false)
    expect(isEnvelopeBookableOn(closed, '2026-09-01')).toBe(true)
    expect(isEnvelopeBookableOn(closed, new Date(2026, 9, 4, 23))).toBe(true)
    expect(isEnvelopeBookableOn(closed, '2026-10-05')).toBe(false)
  })
})

describe('envelopesBookableOn', () => {
  it('filters by booking date', () => {
    const list = [envelope('open'), envelope('closed', { closedAt: new Date(2026, 9, 5, 12) }), envelope('later', { balanceSince: new Date(2026, 10, 1, 12) })]
    expect(envelopesBookableOn(list, new Date(2026, 9, 1)).map((item) => item.id)).toEqual(['open', 'closed'])
    expect(envelopesBookableOn(list, new Date(2026, 10, 2)).map((item) => item.id)).toEqual(['open', 'later'])
  })

  it('offers all open envelopes without a date', () => {
    const list = [envelope('open'), envelope('closed', { closedAt: new Date(2026, 9, 5, 12) })]
    expect(envelopesBookableOn(list, null).map((item) => item.id)).toEqual(['open'])
  })
})

describe('sortEnvelopes', () => {
  it('sorts by group, then by name', () => {
    const list = [envelope('Urlaub', { group: 'SAVINGS' }), envelope('Tanken'), envelope('Wohnen', { group: 'FIXED' }), envelope('Kinder')]
    expect(sortEnvelopes(list).map((item) => item.id)).toEqual(['Kinder', 'Tanken', 'Wohnen', 'Urlaub'])
  })
})

describe('ENVELOPE_GROUPS', () => {
  it('lists the five groups with their allocation default', () => {
    expect(ENVELOPE_GROUPS.map((group) => [group.value, group.defaultAllocation])).toEqual([
      ['RUNNING', 'FIXED'],
      ['FIXED', 'PLANS'],
      ['RESERVE', 'FIXED'],
      ['SAVINGS', 'NONE'],
      ['PERSONAL', 'NONE'],
    ])
  })

  it('recognises only known groups in the URL', () => {
    expect(isEnvelopeGroup('SAVINGS')).toBe(true)
    expect(isEnvelopeGroup('BUDGET')).toBe(false)
    expect(isEnvelopeGroup(undefined)).toBe(false)
  })
})

describe('isEnvelopeOpenOn', () => {
  const closedAt = new Date(2026, 11, 1, 12).toISOString()

  it('is open without a closing date', () => {
    expect(isEnvelopeOpenOn({ closedAt: null })).toBe(true)
  })

  it('compares days, so the closing day counts as closed even before noon', () => {
    expect(isEnvelopeOpenOn({ closedAt }, new Date(2026, 10, 30, 23, 59))).toBe(true)
    expect(isEnvelopeOpenOn({ closedAt }, new Date(2026, 11, 1, 8))).toBe(false)
  })
})

describe('isBeforeLedger', () => {
  const ledgerSince = new Date(2026, 10, 4, 12).toISOString()

  it('compares days', () => {
    expect(isBeforeLedger(new Date(2026, 10, 3, 23), ledgerSince)).toBe(true)
    expect(isBeforeLedger(new Date(2026, 10, 4, 8), ledgerSince)).toBe(false)
  })
})
