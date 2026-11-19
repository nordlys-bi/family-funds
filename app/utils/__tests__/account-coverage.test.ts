import { describe, expect, it } from 'vitest'
import { buildBalanceSheet, computeAccountStatus, computeCoverage, type CoverageAccount, type CoverageEnvelope, type StatusAccount } from '../account-coverage'

/*
 * Wie ein Haushalt mit Alltag (Giro + zweimal Bargeld) und Sparkonto:
 * Lebensmittel haengt an allen drei Alltagskonten, Ruecklagen nur am
 * Sparkonto. Betraege in Cent.
 */
const accounts: CoverageAccount[] = [
  { id: 'giro', name: 'Girokonto', balance: 101408 },
  { id: 'cashJan', name: 'Bar Jan', balance: 3000 },
  { id: 'cashNina', name: 'Bar Nina', balance: 2000 },
  { id: 'savings', name: 'Sparkonto', balance: 785933 },
]

function envelope(id: string, balance: number, accountIds: string[], reserved = 0): CoverageEnvelope {
  return { id, name: id, balance, reserved, accountIds }
}

const envelopes = [
  envelope('food', 37869, ['giro', 'cashJan', 'cashNina'], 60000),
  envelope('kids', -25536, ['giro', 'cashJan']),
  envelope('fixed', 15000, ['giro']),
  envelope('repairs', 50000, ['savings']),
  envelope('luxury', 155926, ['savings']),
]

describe('computeCoverage', () => {
  it('groups accounts connected by bindings and compares them with their envelopes', () => {
    const { groups, hasBindings } = computeCoverage(accounts, envelopes)

    expect(hasBindings).toBe(true)
    expect(groups.map((group) => [group.accounts.map((account) => account.id), group.envelopes.map((item) => item.id)])).toEqual([
      [['giro', 'cashJan', 'cashNina'], ['food', 'kids', 'fixed']],
      [['savings'], ['repairs', 'luxury']],
    ])
    expect(groups[0]).toMatchObject({ accountTotal: 106408, envelopeTotal: 27333, rest: 79075, reserved: 60000, restAfterReserved: 19075 })
    expect(groups[1]).toMatchObject({ accountTotal: 785933, envelopeTotal: 205926, rest: 580007, reserved: 0, restAfterReserved: 580007 })
  })

  it('shows a shortfall when envelopes promise more than lies on their accounts', () => {
    const { groups } = computeCoverage(
      [{ id: 'savings', name: 'Sparkonto', balance: 10000 }],
      [envelope('holiday', 25000, ['savings'])],
    )
    expect(groups[0]).toMatchObject({ rest: -15000, restAfterReserved: -15000 })
  })

  it('merges groups when one envelope spans them', () => {
    const { groups } = computeCoverage(accounts, [...envelopes, envelope('mixed', 100, ['cashNina', 'savings'])])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.accounts.map((account) => account.id)).toEqual(['giro', 'cashJan', 'cashNina', 'savings'])
  })

  it('keeps unbound envelopes apart; all rests add up to "Zu verteilen" + unbound envelopes', () => {
    const all = [...envelopes, envelope('loose', 4000, [], 500), envelope('stale', 700, ['deleted-account'])]
    const { groups, unbound } = computeCoverage(accounts, all)

    expect(unbound).toMatchObject({ total: 4700, reserved: 500 })
    expect(unbound.envelopes.map((item) => item.id)).toEqual(['loose', 'stale'])
    // Invariante: Σ Konten = Σ Umschlaege + Zu verteilen.
    const accountSum = accounts.reduce((total, account) => total + account.balance, 0)
    const envelopeSum = all.reduce((total, item) => total + item.balance, 0)
    const unassigned = accountSum - envelopeSum
    expect(groups.reduce((total, group) => total + group.rest, 0)).toBe(unassigned + unbound.total)
  })

  it('has no bindings to show without any bound envelope; each account stays its own group', () => {
    const { groups, hasBindings } = computeCoverage(accounts, [envelope('loose', 100, [])])
    expect(hasBindings).toBe(false)
    expect(groups).toHaveLength(4)
  })
})

/*
 * Befunde: "Zu verteilen" gehoert zu Giro & Bar (Heimatgruppe). Konten und
 * Umschlaege wie bei Jan: Alltag (Giro + Bar) und Sparkonto.
 */
describe('computeAccountStatus', () => {
  const TODAY = new Date(2026, 10, 19, 12)
  const status = (accounts: StatusAccount[], envelopes: CoverageEnvelope[]) => computeAccountStatus(accounts, envelopes, TODAY)
  const account = (id: string, type: StatusAccount['type'], balance: number, extra: Partial<StatusAccount> = {}): StatusAccount => ({
    id, name: { giro: 'Girokonto', cash: 'Bar Jan', savings: 'Sparkonto', holiday: 'Urlaubskonto' }[id] ?? id, type, balance,
    startDate: '2026-11-17', lastReconciledAt: null, ...extra,
  })
  const everyday = [account('giro', 'CHECKING', 100000), account('cash', 'CASH', 3000)]

  it('points out money parked on the savings account: the forgotten transfer', () => {
    // Luxus → Kinder umgebucht, aber kein Uebertrag: Alltag gedeckt, Sparkonto 200 € ueber.
    const result = status([...everyday, account('savings', 'SAVINGS', 50000)], [
      envelope('kids', 71700, ['giro', 'cash']),
      envelope('luxury', 30000, ['savings']),
    ])

    expect(result.problems).toBe(0)
    expect(result.groupLabels).toEqual(['Girokonto & Bar', 'Sparkonto'])
    expect(result.groupStatus).toEqual(['ok', 'surplus'])
    expect(result.findings).toEqual([
      { kind: 'surplus', severity: 'hint', groupLabel: 'Sparkonto', homeLabel: 'Girokonto & Bar', amount: 20000, transfer: { fromAccountId: 'savings', toAccountId: 'giro', amount: 20000 } },
    ])
  })

  it('suggests the transfer that closes a gap on Giro & Bar, and then nothing is left over', () => {
    const result = status([...everyday, account('savings', 'SAVINGS', 50000)], [
      envelope('kids', 123000, ['giro', 'cash']),
      envelope('luxury', 30000, ['savings']),
    ])

    expect(result.problems).toBe(1)
    expect(result.findings).toEqual([
      { kind: 'missing', severity: 'problem', groupLabel: 'Girokonto & Bar', amount: 20000, sourceLabel: 'Sparkonto', transfer: { fromAccountId: 'savings', toAccountId: 'giro', amount: 20000 }, accountId: 'giro' },
    ])
    expect(result.groupStatus).toEqual(['missing', 'ok'])
  })

  it('asks for the savings rate from Giro when the savings account is short', () => {
    const result = status([...everyday, account('savings', 'SAVINGS', 50000)], [
      envelope('food', 20000, ['giro', 'cash']),
      envelope('luxury', 80000, ['savings']),
    ])
    expect(result.findings[0]).toMatchObject({ kind: 'missing', groupLabel: 'Sparkonto', amount: 30000, transfer: { fromAccountId: 'giro', toAccountId: 'savings', amount: 30000 } })
  })

  it('covers only what the source has, and says when nothing is left anywhere', () => {
    const partly = status([...everyday, account('savings', 'SAVINGS', 50000)], [
      envelope('kids', 160000, ['giro', 'cash']),
      envelope('luxury', 40000, ['savings']),
    ])
    expect(partly.findings[0]).toMatchObject({ amount: 57000, transfer: { amount: 10000 } })

    const none = status(everyday, [envelope('kids', 110000, ['giro', 'cash'])])
    expect(none.findings[0]).toMatchObject({ kind: 'missing', amount: 7000, sourceLabel: null, transfer: null })
  })

  it('warns only after reserved allocations when that is what makes it tight', () => {
    const result = status(everyday, [envelope('food', 50000, ['giro', 'cash'], 60000)])
    expect(result.findings).toEqual([
      { kind: 'tight', severity: 'hint', groupLabel: 'Girokonto & Bar', amount: 7000, reserved: 60000, mainAccountName: 'Girokonto' },
    ])
  })

  it('reminds to reconcile cash after 14 days and bank accounts after 30, counting from the start if never reconciled', () => {
    const result = status([
      account('giro', 'CHECKING', 0, { startDate: '2026-10-25' }),
      account('cash', 'CASH', 0, { startDate: '2026-10-01', lastReconciledAt: '2026-11-04' }),
      account('savings', 'SAVINGS', 0, { startDate: '2026-10-01', lastReconciledAt: '2026-10-19' }),
      account('holiday', 'SAVINGS', 0, { startDate: '2026-01-01', closedAt: '2026-11-01' }),
    ], [envelope('food', 0, ['giro', 'cash'])])

    expect(result.findings).toEqual([
      { kind: 'reconcile', severity: 'hint', accountId: 'cash', accountName: 'Bar Jan', days: 15, never: false },
      { kind: 'reconcile', severity: 'hint', accountId: 'savings', accountName: 'Sparkonto', days: 31, never: false },
    ])
  })
})

describe('buildBalanceSheet', () => {
  const sheetOf = (accountsInGroup: CoverageAccount[], envelopesInGroup: CoverageEnvelope[], home: boolean) =>
    buildBalanceSheet(computeCoverage(accountsInGroup, envelopesInGroup).groups[0]!, home)
  const typed = (id: string, balance: number, group: CoverageEnvelope['group']) => ({ ...envelope(id, balance, ['giro']), group })

  it('balances both sides with "Zu verteilen" on Giro & Bar and lists few envelopes one by one', () => {
    const sheet = sheetOf([accounts[0]!], [typed('food', 30000, 'RUNNING'), typed('rent', 50000, 'FIXED')], true)

    expect(sheet.lines.map((line) => line.kind === 'envelope' && line.envelope.id)).toEqual(['rent', 'food'])
    expect(sheet.balancing).toEqual({ kind: 'unassigned', amount: 101408 - 80000 })
    expect(sheet.missing).toBe(0)
    expect(sheet.total).toBe(101408)
  })

  it('calls the surplus elsewhere "unverplant" and puts a shortfall on the account side', () => {
    expect(sheetOf([accounts[3]!], [{ ...envelope('x', 700000, ['savings']), group: 'RESERVE' }], false).balancing).toEqual({ kind: 'unplanned', amount: 85933 })

    const short = sheetOf([{ id: 'holiday', name: 'Urlaubskonto', balance: 30000 }], [{ ...envelope('trip', 37800, ['holiday']), group: 'SAVINGS' }], false)
    expect(short).toMatchObject({ missing: 7800, balancing: null, total: 37800 })
  })

  it('condenses many envelopes by envelope group but keeps overdrawn ones apart', () => {
    const many = [
      typed('food', 2000, 'RUNNING'), typed('fuel', 1000, 'RUNNING'), typed('kids', -5500, 'RUNNING'),
      typed('rent', 4000, 'FIXED'), typed('car', 3000, 'FIXED'), typed('jan', 500, 'PERSONAL'),
    ]
    const sheet = sheetOf([accounts[0]!], many, true)

    expect(sheet.lines.map((line) => (line.kind === 'group' ? [line.label, line.envelopes.length, line.total] : line.envelope.id))).toEqual([
      ['Laufende Ausgaben', 2, 3000],
      ['Fixkosten', 2, 7000],
      ['Persönlich', 1, 500],
      'kids',
    ])
    // Rechts: Umschlaege + Zu verteilen = links: Konten.
    const right = sheet.lines.reduce((sum, line) => sum + (line.kind === 'group' ? line.total : line.envelope.balance), 0) + (sheet.balancing?.amount ?? 0)
    expect(right).toBe(sheet.total)
  })
})
