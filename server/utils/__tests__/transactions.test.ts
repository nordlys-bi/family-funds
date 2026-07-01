import { describe, expect, it } from 'vitest'
import { assertTransactionKind, transactionKinds } from '../transactions'

describe('transactionKinds', () => {
  it('exposes expense and income as the only kinds', () => {
    expect(transactionKinds).toEqual(['expense', 'income'])
  })
})

describe('assertTransactionKind', () => {
  it('accepts valid kinds unchanged', () => {
    expect(assertTransactionKind('expense')).toBe('expense')
    expect(assertTransactionKind('income')).toBe('income')
  })

  it('throws 400 for unknown strings', () => {
    expect(() => assertTransactionKind('transfer')).toThrowError(/Invalid transaction kind/)
  })

  it('throws 400 for non-string values', () => {
    expect(() => assertTransactionKind(null)).toThrowError(/Invalid transaction kind/)
    expect(() => assertTransactionKind(undefined)).toThrowError(/Invalid transaction kind/)
    expect(() => assertTransactionKind(0)).toThrowError(/Invalid transaction kind/)
  })
})