import { describe, expect, it } from 'vitest'
import { accountErrorText, accountTypeLabel, introductionTotals } from '../account-options'

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
