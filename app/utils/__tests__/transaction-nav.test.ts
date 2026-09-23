import { describe, expect, it } from 'vitest'
import {
  isTransactionsPath,
  transactionSwitchQuery,
  transactionSwitchTarget,
  transactionTypeFromPath,
} from '../transaction-nav'

describe('transactionTypeFromPath', () => {
  it('erkennt Ausgaben und Einnahmen', () => {
    expect(transactionTypeFromPath('/transactions/expenses')).toBe('expenses')
    expect(transactionTypeFromPath('/transactions/income')).toBe('income')
  })

  it('erkennt Unterpfade, aber keine aehnlich beginnenden Pfade', () => {
    expect(transactionTypeFromPath('/transactions/expenses/123')).toBe('expenses')
    expect(transactionTypeFromPath('/transactions/expenses-old')).toBeNull()
  })

  it('liefert null ausserhalb von Ausgaben/Einnahmen', () => {
    expect(transactionTypeFromPath('/transactions')).toBeNull()
    expect(transactionTypeFromPath('/budgeting/budgets')).toBeNull()
    expect(transactionTypeFromPath('/')).toBeNull()
  })
})

describe('isTransactionsPath', () => {
  it('gilt fuer den ganzen Buchungen-Bereich', () => {
    expect(isTransactionsPath('/transactions')).toBe(true)
    expect(isTransactionsPath('/transactions/expenses')).toBe(true)
    expect(isTransactionsPath('/transactions/income')).toBe(true)
  })

  it('gilt nicht fuer andere Bereiche oder aehnlich beginnende Pfade', () => {
    expect(isTransactionsPath('/')).toBe(false)
    expect(isTransactionsPath('/budgeting/budgets')).toBe(false)
    expect(isTransactionsPath('/transactions-archive')).toBe(false)
  })
})

describe('transactionSwitchQuery', () => {
  it('nimmt month und userId mit', () => {
    expect(transactionSwitchQuery({ month: '2026-07', userId: 'm-1' })).toEqual({ month: '2026-07', userId: 'm-1' })
  })

  it('verwirft Ausgaben-spezifische Filter und Einmal-Trigger', () => {
    expect(
      transactionSwitchQuery({
        month: '2026-07',
        unassigned: '1',
        budgetId: 'b-1',
        from: '2026-09-01',
        to: '2026-09-06',
        new: '1',
      }),
    ).toEqual({ month: '2026-07' })
  })

  it('liefert einen leeren Query, wenn nichts mitzunehmen ist (Default-Monat)', () => {
    expect(transactionSwitchQuery({})).toEqual({})
    expect(transactionSwitchQuery({ unassigned: '1' })).toEqual({})
  })

  it('verwirft einen ungueltigen month', () => {
    expect(transactionSwitchQuery({ month: '2026-13' })).toEqual({})
    expect(transactionSwitchQuery({ month: 'juli' })).toEqual({})
    expect(transactionSwitchQuery({ month: '' })).toEqual({})
  })

  it('verwirft einen leeren userId', () => {
    expect(transactionSwitchQuery({ userId: '' })).toEqual({})
  })

  it('nimmt bei wiederholten Query-Parametern (Array) den ersten Wert', () => {
    expect(transactionSwitchQuery({ month: ['2026-07', '2026-08'], userId: ['m-1', 'm-2'] })).toEqual({
      month: '2026-07',
      userId: 'm-1',
    })
  })

  it('ignoriert Nicht-Strings', () => {
    expect(transactionSwitchQuery({ month: 202607, userId: null })).toEqual({})
  })
})

describe('transactionSwitchTarget', () => {
  it('baut Pfad und Query fuer den Wechsel', () => {
    expect(transactionSwitchTarget('income', { month: '2026-07', unassigned: '1' })).toEqual({
      path: '/transactions/income',
      query: { month: '2026-07' },
    })
    expect(transactionSwitchTarget('expenses', { userId: 'm-1' })).toEqual({
      path: '/transactions/expenses',
      query: { userId: 'm-1' },
    })
  })
})
