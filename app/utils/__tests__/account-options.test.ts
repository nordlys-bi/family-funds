import { describe, expect, it } from 'vitest'
import { accountErrorText, accountTypeLabel, defaultPaidWith, introductionTotals, OTHER_ACCOUNT, paidWithOptions, type PaidWithAccount } from '../account-options'

describe('introductionTotals', () => {
  it('derives the new start of "Zu verteilen" and the difference to before', () => {
    // 4.000 € + 50,25 € auf den Konten, 550 € in Umschlaegen, bisher 2.800 € frei.
    expect(introductionTotals({ envelopesBefore: 55000, unassignedBefore: 280000 }, [4000, 50.25, null])).toEqual({
      accounts: 405025,
      unassigned: 350025,
      difference: 70025,
    })
  })

  it('may be negative when the accounts hold less than the envelopes', () => {
    expect(introductionTotals({ envelopesBefore: 55000, unassignedBefore: 0 }, [-100])).toEqual({
      accounts: -10000,
      unassigned: -65000,
      difference: -65000,
    })
  })
})

describe('accountErrorText', () => {
  it('translates known reasons from the server error', () => {
    expect(accountErrorText({ data: { data: { reason: 'bookings-without-account', count: 2 } } })).toContain('2 Buchung(en) ohne Konto')
    expect(accountErrorText({ data: { data: { reason: 'last-account' } } })).toBe('Das letzte Konto lässt sich nicht löschen.')
  })

  it('falls back to the status message', () => {
    expect(accountErrorText({ statusMessage: 'Boom' })).toBe('Boom')
  })
})

describe('accountTypeLabel', () => {
  it('names the account types in German', () => {
    expect(accountTypeLabel('CASH')).toBe('Bargeld')
  })
})

/*
 * "Bezahlt mit" (issue #190): Girokonto und Gemeinschaftskonto seit dem
 * Stichtag, Geldbeutel seit 10.11., ein altes Konto bis 15.11. (exklusiv).
 */
const accounts: PaidWithAccount[] = [
  { id: 'giro', name: 'Girokonto', type: 'CHECKING', startDate: '2026-11-03' },
  { id: 'joint', name: 'Gemeinschaftskonto', type: 'CHECKING', startDate: '2026-11-03' },
  { id: 'cash', name: 'Geldbeutel', type: 'CASH', startDate: '2026-11-10' },
  { id: 'old', name: 'Altes Konto', type: 'SAVINGS', startDate: '2026-11-03', closedAt: '2026-11-15' },
]
const values = (options: Array<{ value: string }>) => options.map((option) => option.value)

describe('paidWithOptions', () => {
  it('offers every account open on the day without a binding', () => {
    expect(values(paidWithOptions({ accounts, date: '2026-11-20' }))).toEqual(['giro', 'joint', 'cash'])
    expect(values(paidWithOptions({ accounts, date: '2026-11-05' }))).toEqual(['giro', 'joint', 'old'])
  })

  it('offers the bound accounts and "Anderes Konto…" for the rest', () => {
    const binding = { accountIds: ['giro', 'joint'], primaryAccountId: 'giro' }
    expect(values(paidWithOptions({ accounts, date: '2026-11-20', binding }))).toEqual(['giro', 'joint', OTHER_ACCOUNT])
    expect(values(paidWithOptions({ accounts, date: '2026-11-20', binding, showAll: true }))).toEqual(['giro', 'joint', 'cash'])
  })

  it('drops "Anderes Konto…" when nothing else is open that day', () => {
    const binding = { accountIds: ['giro', 'joint', 'old'], primaryAccountId: 'giro' }
    expect(values(paidWithOptions({ accounts, date: '2026-11-05', binding }))).toEqual(['giro', 'joint', 'old'])
  })

  it('keeps the selected account visible even outside the binding or its run', () => {
    const binding = { accountIds: ['giro'], primaryAccountId: 'giro' }
    expect(values(paidWithOptions({ accounts, date: '2026-11-20', binding, selectedId: 'cash' }))).toEqual(['giro', 'cash', OTHER_ACCOUNT])
    expect(values(paidWithOptions({ accounts, date: '2026-11-20', selectedId: 'old' }))).toEqual(['giro', 'joint', 'cash', 'old'])
  })
})

describe('defaultPaidWith', () => {
  it('prefers the primary account, then another bound one', () => {
    expect(defaultPaidWith({ accounts, date: '2026-11-20', binding: { accountIds: ['giro', 'joint'], primaryAccountId: 'joint' }, memberDefaultId: 'cash' })).toBe('joint')
    expect(defaultPaidWith({ accounts, date: '2026-11-20', binding: { accountIds: ['old', 'joint'], primaryAccountId: 'old' } })).toBe('joint')
  })

  it('uses the member default only without a binding', () => {
    expect(defaultPaidWith({ accounts, date: '2026-11-20', binding: { accountIds: [], primaryAccountId: null }, memberDefaultId: 'cash' })).toBe('cash')
    expect(defaultPaidWith({ accounts, date: '2026-11-05', memberDefaultId: 'cash' })).toBeNull()
  })

  it('takes the only account of the day, otherwise leaves the choice open', () => {
    expect(defaultPaidWith({ accounts: accounts.slice(0, 1), date: '2026-11-20' })).toBe('giro')
    expect(defaultPaidWith({ accounts, date: '2026-11-20' })).toBeNull()
    expect(defaultPaidWith({ accounts, date: '2026-11-01' })).toBeNull()
  })
})
