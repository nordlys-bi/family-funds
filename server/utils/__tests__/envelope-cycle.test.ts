import { describe, expect, it } from 'vitest'
import { wouldCreateCarryoverCycle } from '../envelope-lifecycle'

describe('wouldCreateCarryoverCycle', () => {
  const envelopes = [
    { id: 'a', carryoverToEnvelopeId: 'b' },
    { id: 'b', carryoverToEnvelopeId: 'c' },
    { id: 'c', carryoverToEnvelopeId: null },
    { id: 'x', carryoverToEnvelopeId: 'y' },
    { id: 'y', carryoverToEnvelopeId: 'x' },
  ]

  it('finds a direct and a transitive way back', () => {
    expect(wouldCreateCarryoverCycle('c', 'b', envelopes)).toBe(true)
    expect(wouldCreateCarryoverCycle('c', 'a', envelopes)).toBe(true)
  })

  it('allows a legitimate chain', () => {
    expect(wouldCreateCarryoverCycle('a', 'c', envelopes)).toBe(false)
    expect(wouldCreateCarryoverCycle('new', 'a', envelopes)).toBe(false)
  })

  it('stops on a cycle that already exists elsewhere', () => {
    expect(wouldCreateCarryoverCycle('new', 'x', envelopes)).toBe(false)
  })
})
