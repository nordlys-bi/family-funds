/**
 * Deckung je Kontengruppe (issue #198, ADR-0006).
 *
 * Pro Umschlag laesst sich nicht sagen, auf welchem Konto sein Geld liegt:
 * Die Bindung ist nur ein Eingabefilter, die Invariante gilt global. Die
 * Bindungen zerlegen die Konten aber von selbst in Gruppen: Zwei Konten
 * gehoeren zusammen, sobald ein Umschlag an beide gebunden ist. Fuer jede
 * Gruppe gilt dann
 *
 *   Rest = Σ Konten der Gruppe − Σ Umschlaege, die an Konten der Gruppe gebunden sind
 *
 * Positiv: Dort liegt freies Geld ("Zu verteilen"). Negativ: Die Umschlaege
 * versprechen mehr, als dort liegt (Sparrate zugeteilt, aber nicht
 * ueberwiesen). Umschlaege ohne Bindung und "Zu verteilen" lassen sich keiner
 * Gruppe zuordnen; die Reste aller Gruppen ergeben zusammen genau "Zu
 * verteilen" + Umschlaege ohne Bindung.
 *
 * "Nach Vormerkung" zieht zusaetzlich ab, was im laufenden Monat noch aus
 * "Zu verteilen" in Umschlaege der Gruppe zugeteilt wird.
 *
 * Reine Anzeige, abgeleitet aus Salden und Bindungen; keine Regel beim Buchen.
 */

import { ENVELOPE_GROUPS, type EnvelopeGroup } from './envelope-options'

export type CoverageAccount = {
  id: string
  name: string
  /** Saldo heute, in Cent. */
  balance: number
}

export type CoverageEnvelope = {
  id: string
  name: string
  /** Saldo heute, in Cent. Nur offene Umschlaege uebergeben. */
  balance: number
  /** Bis Monatsende noch faellige Zuteilungen, in Cent. */
  reserved: number
  /** Gebundene Konten; leer = keine Bindung. */
  accountIds: string[]
  /** Umschlaggruppe, fuer die verdichtete Bilanz (Laufend, Fixkosten …). */
  group?: EnvelopeGroup
}

export type CoverageGroup = {
  accounts: CoverageAccount[]
  envelopes: CoverageEnvelope[]
  accountTotal: number
  envelopeTotal: number
  /** Konten − Umschlaege. */
  rest: number
  reserved: number
  /** Rest − Vormerkung. */
  restAfterReserved: number
}

export type Coverage = {
  groups: CoverageGroup[]
  /** Umschlaege ohne Bindung (oder nur an unbekannte Konten gebunden). */
  unbound: { envelopes: CoverageEnvelope[]; total: number; reserved: number }
  /** True, sobald mindestens ein Umschlag gebunden ist; vorher sagt die Aufteilung nichts. */
  hasBindings: boolean
}

const sum = <T>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0)

/**
 * Teilt Konten und Umschlaege in Gruppen. Reihenfolge der Gruppen und der
 * Konten darin wie in `accounts`.
 */
export function computeCoverage(accounts: CoverageAccount[], envelopes: CoverageEnvelope[]): Coverage {
  // Union-Find ueber die Konten: Jede Bindung an mehrere Konten verbindet sie.
  const parent = new Map(accounts.map((account) => [account.id, account.id]))
  const root = (id: string): string => {
    const next = parent.get(id)!
    if (next === id) return id
    const top = root(next)
    parent.set(id, top)
    return top
  }

  const boundEnvelopes: Array<{ envelope: CoverageEnvelope; ids: string[] }> = []
  const unbound: CoverageEnvelope[] = []
  for (const envelope of envelopes) {
    const ids = envelope.accountIds.filter((id) => parent.has(id))
    if (ids.length === 0) {
      unbound.push(envelope)
      continue
    }
    for (const id of ids.slice(1)) parent.set(root(id), root(ids[0]!))
    boundEnvelopes.push({ envelope, ids })
  }

  const byRoot = new Map<string, { accounts: CoverageAccount[]; envelopes: CoverageEnvelope[] }>()
  for (const account of accounts) {
    const key = root(account.id)
    if (!byRoot.has(key)) byRoot.set(key, { accounts: [], envelopes: [] })
    byRoot.get(key)!.accounts.push(account)
  }
  for (const { envelope, ids } of boundEnvelopes) byRoot.get(root(ids[0]!))!.envelopes.push(envelope)

  const groups = [...byRoot.values()].map((group): CoverageGroup => {
    const accountTotal = sum(group.accounts, (account) => account.balance)
    const envelopeTotal = sum(group.envelopes, (envelope) => envelope.balance)
    const reserved = sum(group.envelopes, (envelope) => envelope.reserved)
    return {
      ...group,
      accountTotal,
      envelopeTotal,
      rest: accountTotal - envelopeTotal,
      reserved,
      restAfterReserved: accountTotal - envelopeTotal - reserved,
    }
  })

  return {
    groups,
    unbound: { envelopes: unbound, total: sum(unbound, (envelope) => envelope.balance), reserved: sum(unbound, (envelope) => envelope.reserved) },
    hasBindings: boundEnvelopes.length > 0,
  }
}

// === Befunde (issue #198, Gegenentwurf mit Status zuerst) ===================
//
// Die Deckung soll sagen, was zu tun ist, nicht nur rechnen. Festgelegt mit
// Jan: "Zu verteilen" gehoert zum Alltagsgeld, also zur Gruppe des
// Girokontos ("Heimatgruppe"). Ein Ueberschuss anderswo (Sparkonto) ist darum
// ein Hinweis: zuteilen oder aufs Giro uebertragen. So faellt ein vergessener
// Kontouebertrag auf, auch wenn rechnerisch alles gedeckt ist.

export type StatusAccount = CoverageAccount & {
  type: 'CHECKING' | 'CASH' | 'SAVINGS'
  startDate: string | Date
  closedAt?: string | Date | null
  lastReconciledAt?: string | Date | null
}

export type SuggestedTransfer = { fromAccountId: string; toAccountId: string; amount: number }

export type CoverageFinding =
  /** Rest < 0: Die Umschlaege versprechen mehr, als auf den Konten liegt. */
  | { kind: 'missing'; severity: 'problem'; groupLabel: string; amount: number; sourceLabel: string | null; transfer: SuggestedTransfer | null; accountId: string | null }
  /** Rest > 0 ausserhalb der Heimatgruppe: Geld liegt dort unverplant. */
  | { kind: 'surplus'; severity: 'hint'; groupLabel: string; homeLabel: string; amount: number; transfer: SuggestedTransfer | null }
  /** Rest ≥ 0, aber die Vormerkungen bis Monatsende brauchen mehr. */
  | { kind: 'tight'; severity: 'hint'; groupLabel: string; amount: number; reserved: number; mainAccountName: string }
  /** Abgleich ueberfaellig: Die Deckung stimmt nur, wenn die Kontostaende stimmen. */
  | { kind: 'reconcile'; severity: 'hint'; accountId: string; accountName: string; days: number; never: boolean }

export type GroupStatus = 'ok' | 'missing' | 'surplus'

export type AccountStatus = {
  coverage: Coverage
  /** Index der Heimatgruppe in `coverage.groups`; -1 ohne Girokonto. */
  homeIndex: number
  groupLabels: string[]
  groupStatus: GroupStatus[]
  findings: CoverageFinding[]
  problems: number
  hints: number
}

/** Frist fuer den Abgleich: Bargeld haeufiger, weil dort am leichtesten etwas untergeht. */
export const RECONCILE_DAYS = { CASH: 14, CHECKING: 30, SAVINGS: 30 } as const

const DAY_MS = 24 * 60 * 60 * 1000

function dayStart(value: string | Date) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

/** Konto, auf das ein Uebertrag zielt oder von dem er kommt: nie Bargeld (das hiesse abheben). */
function mainAccount(accounts: StatusAccount[]) {
  return [...accounts].filter((account) => account.type !== 'CASH').sort((left, right) => right.balance - left.balance)[0] ?? null
}

/** "Girokonto & Bar", "Sparkonto" oder die Namen der Konten. */
export function groupLabel(accounts: StatusAccount[]) {
  if (accounts.length === 1) return accounts[0]!.name
  const main = mainAccount(accounts)
  const hasCash = accounts.some((account) => account.type === 'CASH')
  if (main && hasCash && accounts.filter((account) => account.type !== 'CASH').length === 1) return `${main.name} & Bar`
  return accounts.map((account) => account.name).join(' · ')
}

/**
 * Status der Konten: Deckung je Gruppe plus Befunde, Probleme zuerst. Die
 * vorgeschlagenen Uebertraege sind fachlich sauber, weil ein Kontouebertrag
 * weder Umschlaege noch "Zu verteilen" beruehrt; er verschiebt nur Rest von
 * einer Gruppe zur anderen. Welche Quelle gemeint ist, bleibt eine Heuristik.
 */
export function computeAccountStatus(
  accounts: StatusAccount[],
  envelopes: CoverageEnvelope[],
  today: Date = new Date(),
): AccountStatus {
  const open = accounts.filter((account) => !account.closedAt || dayStart(account.closedAt) > dayStart(today))
  const raw = computeCoverage(accounts, envelopes)
  // Gruppen nur aus leeren geschlossenen Konten sagen nichts.
  const openIds = new Set(open.map((account) => account.id))
  const coverage: Coverage = {
    ...raw,
    groups: raw.groups.filter((group) => group.envelopes.length > 0 || group.accountTotal !== 0 || group.accounts.some((account) => openIds.has(account.id))),
  }
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const groupAccounts = coverage.groups.map((group) => group.accounts.map((account) => byId.get(account.id)!))
  const groupLabels = groupAccounts.map(groupLabel)

  const checking = open.filter((account) => account.type === 'CHECKING').sort((left, right) => right.balance - left.balance)[0]
  const homeIndex = checking ? coverage.groups.findIndex((group) => group.accounts.some((account) => account.id === checking.id)) : -1

  const findings: CoverageFinding[] = []
  // Was an Ueberschuss noch frei ist, nachdem er einen Fehlbetrag deckt.
  const spare = coverage.groups.map((group) => Math.max(group.rest, 0))

  coverage.groups.forEach((group, index) => {
    if (group.rest >= 0) return
    const deficit = -group.rest
    // Fehlt es im Alltag, kommt das Geld von dem anderen Konto mit dem
    // groessten Ueberschuss; fehlt es auf einem Sparkonto (Sparrate nicht
    // ueberwiesen), vom Alltag.
    const candidates = coverage.groups
      .map((_, other) => other)
      .filter((other) => other !== index && spare[other]! > 0 && mainAccount(groupAccounts[other]!))
    const sourceIndex = index === homeIndex
      ? candidates.sort((left, right) => spare[right]! - spare[left]!)[0]
      : candidates.includes(homeIndex) ? homeIndex : candidates.sort((left, right) => spare[right]! - spare[left]!)[0]
    const target = mainAccount(groupAccounts[index]!)
    let transfer: SuggestedTransfer | null = null
    if (sourceIndex !== undefined && target) {
      const amount = Math.min(deficit, spare[sourceIndex]!)
      spare[sourceIndex] = spare[sourceIndex]! - amount
      transfer = { fromAccountId: mainAccount(groupAccounts[sourceIndex]!)!.id, toAccountId: target.id, amount }
    }
    findings.push({
      kind: 'missing',
      severity: 'problem',
      groupLabel: groupLabels[index]!,
      amount: deficit,
      sourceLabel: sourceIndex !== undefined ? groupLabels[sourceIndex]! : null,
      transfer,
      // Fuer "Andere Ursache? Abgleichen".
      accountId: target?.id ?? groupAccounts[index]![0]!.id,
    })
  })

  const home = homeIndex >= 0 ? mainAccount(groupAccounts[homeIndex]!) : null
  coverage.groups.forEach((group, index) => {
    if (index === homeIndex || homeIndex < 0 || spare[index]! <= 0) return
    const source = mainAccount(groupAccounts[index]!)
    findings.push({
      kind: 'surplus',
      severity: 'hint',
      groupLabel: groupLabels[index]!,
      homeLabel: groupLabels[homeIndex]!,
      amount: spare[index]!,
      transfer: source && home ? { fromAccountId: source.id, toAccountId: home.id, amount: spare[index]! } : null,
    })
  })

  coverage.groups.forEach((group, index) => {
    if (group.rest < 0 || group.restAfterReserved >= 0) return
    findings.push({
      kind: 'tight',
      severity: 'hint',
      groupLabel: groupLabels[index]!,
      amount: -group.restAfterReserved,
      reserved: group.reserved,
      mainAccountName: mainAccount(groupAccounts[index]!)?.name ?? groupLabels[index]!,
    })
  })

  for (const account of open) {
    const since = account.lastReconciledAt ?? account.startDate
    const days = Math.floor((dayStart(today) - dayStart(since)) / DAY_MS)
    if (days > RECONCILE_DAYS[account.type]) {
      findings.push({ kind: 'reconcile', severity: 'hint', accountId: account.id, accountName: account.name, days, never: !account.lastReconciledAt })
    }
  }

  // Ein Ueberschuss, der schon einen Fehlbetrag deckt, ist kein eigener Hinweis.
  const groupStatus = coverage.groups.map((group, index): GroupStatus =>
    group.rest < 0 ? 'missing' : index !== homeIndex && homeIndex >= 0 && spare[index]! > 0 ? 'surplus' : 'ok',
  )
  const problems = findings.filter((finding) => finding.severity === 'problem').length
  return { coverage, homeIndex, groupLabels, groupStatus, findings, problems, hints: findings.length - problems }
}

// === Bilanz je Gruppe (issue #198, zweite Runde) ============================
//
// Links "Liegt auf" (Konten), rechts "Ist gedacht fuer" (Umschlaege), unten
// auf beiden Seiten dieselbe Summe. Der Ausgleichsposten steht dort, wo er
// hingehoert: Ueberschuss rechts als "Zu verteilen" (Heimatgruppe) bzw.
// "unverplant", Fehlbetrag links als "fehlt" (dort fehlt das Geld). Die
// Seiten sind zwei unabhaengige Listen; keine Zeile ist einer Zeile der
// anderen Seite zugeordnet (ADR-0006).

/** Ab so vielen Umschlaegen fasst die rechte Seite nach Umschlaggruppe zusammen. */
export const CONDENSE_FROM = 6

export type BalanceSheetLine =
  | { kind: 'envelope'; envelope: CoverageEnvelope }
  | { kind: 'group'; group: EnvelopeGroup; label: string; envelopes: CoverageEnvelope[]; total: number }

export type BalanceSheet = {
  /** Links fehlt Geld (Rest < 0), in Cent; sonst 0. */
  missing: number
  /** Rechts: Umschlaege, einzeln oder nach Umschlaggruppe. */
  lines: BalanceSheetLine[]
  /** Rechts: Ausgleichsposten bei Rest > 0. */
  balancing: { kind: 'unassigned' | 'unplanned'; amount: number } | null
  /** Summe beider Seiten. */
  total: number
}

const GROUP_ORDER = ENVELOPE_GROUPS.map((item) => item.value)
const byBalance = (left: CoverageEnvelope, right: CoverageEnvelope) => right.balance - left.balance

export function buildBalanceSheet(group: CoverageGroup, home: boolean): BalanceSheet {
  const negatives = group.envelopes.filter((envelope) => envelope.balance < 0).sort((left, right) => left.balance - right.balance)
  const others = group.envelopes.filter((envelope) => envelope.balance >= 0)
  let lines: BalanceSheetLine[]
  if (group.envelopes.length < CONDENSE_FROM) {
    lines = [...others].sort(byBalance).map((envelope) => ({ kind: 'envelope', envelope }))
  } else {
    // Umschlaege im Minus sind ein Handlungspunkt und bleiben einzeln sichtbar.
    const grouped = new Map<EnvelopeGroup, CoverageEnvelope[]>()
    for (const envelope of others) {
      const key = envelope.group ?? 'RUNNING'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(envelope)
    }
    lines = [...grouped.entries()]
      .sort(([left], [right]) => GROUP_ORDER.indexOf(left) - GROUP_ORDER.indexOf(right))
      .map(([key, envelopes]) => ({
        kind: 'group' as const,
        group: key,
        label: ENVELOPE_GROUPS.find((item) => item.value === key)?.label ?? key,
        envelopes: [...envelopes].sort(byBalance),
        total: envelopes.reduce((sum, envelope) => sum + envelope.balance, 0),
      }))
  }
  lines.push(...negatives.map((envelope): BalanceSheetLine => ({ kind: 'envelope', envelope })))

  return {
    missing: group.rest < 0 ? -group.rest : 0,
    lines,
    balancing: group.rest > 0 ? { kind: home ? 'unassigned' : 'unplanned', amount: group.rest } : null,
    total: group.accountTotal + Math.max(-group.rest, 0),
  }
}
