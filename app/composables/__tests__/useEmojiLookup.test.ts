/*
 * Unit-Tests fuer `useEmojiLookup` (issue #8).
 *
 * Testet die vier Lookup-Stufen:
 *   1. Domain-Map Exact-Match
 *   2. Domain-Map Substring-Match
 *   3. emojilib invertierter Index
 *   4. Default-Fallback 💸
 *
 * Plus Edge-Cases: leerer String, Nicht-String, Case-Insensitivity,
 * Mehrfach-Woerter, Tabelle mit Substring-Konflikten.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetEmojiLookupCache, useEmojiLookup } from '../useEmojiLookup'
import { DEFAULT_EMOJI } from '../../utils/emojiDomainMap'

describe('useEmojiLookup — Stufe 1 (Domain-Map Exact-Match)', () => {
  beforeEach(() => __resetEmojiLookupCache())
  afterEach(() => __resetEmojiLookupCache())

  const { lookupEmoji, lookupEmojiWithTier } = useEmojiLookup()

  it('matched Gross-/Kleinschreibung exakt', () => {
    expect(lookupEmoji('Miete')).toBe('🏠')
    expect(lookupEmoji('miete')).toBe('🏠')
    expect(lookupEmoji('MIETE')).toBe('🏠')
  })

  it('matched mit fuehrenden/schliessenden Leerzeichen', () => {
    expect(lookupEmoji('  Miete  ')).toBe('🏠')
  })

  it('reportet tier: 1 fuer Exact-Matches', () => {
    expect(lookupEmojiWithTier('Gehalt').tier).toBe(1)
    expect(lookupEmojiWithTier('Gehalt').emoji).toBe('💰')
  })

  it('matched Domain-Keys mit Umlauten', () => {
    expect(lookupEmoji('Tanken')).toBe('⛽')
    expect(lookupEmoji('ÖPNV')).toBe('🚇')
  })
})

describe('useEmojiLookup — Stufe 2 (Domain-Map Substring-Match)', () => {
  beforeEach(() => __resetEmojiLookupCache())
  afterEach(() => __resetEmojiLookupCache())

  const { lookupEmoji, lookupEmojiWithTier } = useEmojiLookup()

  it('"Rechnung Strom" matcht "strom"', () => {
    expect(lookupEmoji('Rechnung Strom')).toBe('⚡')
    expect(lookupEmojiWithTier('Rechnung Strom').tier).toBe(2)
  })

  it('"Supermarkt Edeka" matcht "edeka" (Substring)', () => {
    expect(lookupEmoji('Supermarkt Edeka')).toBe('🛒')
  })

  it('ignoriert Substring-Kandidaten unter 3 Zeichen (false positives)', () => {
    // "in" wuerde "Internet" matchen, ist aber < 3 Zeichen
    const result = lookupEmoji('In')
    // "in" hat 2 Zeichen — Substring-Stufe ueberspringt, faellt durch
    // auf emojilib oder Default. Erwartet: NICHT '🌐' (Internet-Emoji).
    expect(result).not.toBe('🌐')
  })

  it('"Auto versicherung" waehlt Prioritaet nach Insertion-Order', () => {
    // "auto" (🚗) und "versicherung" (🛡️) matchen beide. Die Domain-Map
    // iteriert in Insertion-Order — "auto" steht vor "versicherung",
    // also gewinnt "auto".
    expect(lookupEmoji('Auto versicherung')).toBe('🚗')
  })
})

describe('useEmojiLookup — Stufe 3 (emojilib invertierter Index)', () => {
  beforeEach(() => __resetEmojiLookupCache())
  afterEach(() => __resetEmojiLookupCache())

  const { lookupEmoji, lookupEmojiWithTier } = useEmojiLookup()

  it('matched emojilib-Keywords, die nicht in der Domain-Map sind', () => {
    // "smile" ist in emojilib fuer 😀 aber nicht in der Domain-Map.
    // Erwartet: irgendein Emoji aus emojilib (nicht Default).
    const result = lookupEmojiWithTier('smile')
    expect(result.tier).toBe(3)
    expect(result.emoji).not.toBe(DEFAULT_EMOJI)
    expect(result.emoji.length).toBeGreaterThan(0)
  })

  it('matched emojilib-Keywords fuer alltagssprachliche Begriffe', () => {
    // "happy" sollte irgendein Emoji liefern (nicht Default)
    const result = lookupEmojiWithTier('happy')
    expect(result.tier).toBe(3)
    expect(result.emoji).not.toBe(DEFAULT_EMOJI)
  })
})

describe('useEmojiLookup — Stufe 4 (Default-Fallback)', () => {
  beforeEach(() => __resetEmojiLookupCache())
  afterEach(() => __resetEmojiLookupCache())

  const { lookupEmoji, lookupEmojiWithTier } = useEmojiLookup()

  it('fallen bei unbekanntem Begriff auf 💸 zurueck', () => {
    expect(lookupEmoji('xyz123unknown')).toBe('💸')
    expect(lookupEmojiWithTier('xyz123unknown').tier).toBe(4)
  })

  it('fallen bei leerem String auf 💸 zurueck', () => {
    expect(lookupEmoji('')).toBe('💸')
    expect(lookupEmoji('   ')).toBe('💸')
  })

  it('Default-EMOJI ist dokumentiert und konstant', () => {
    expect(DEFAULT_EMOJI).toBe('💸')
  })
})

describe('useEmojiLookup — Tier-Reporting', () => {
  beforeEach(() => __resetEmojiLookupCache())
  afterEach(() => __resetEmojiLookupCache())

  const { lookupEmojiWithTier } = useEmojiLookup()

  it('exact > substring > emojilib > default — Tier-Werte spiegeln das', () => {
    expect(lookupEmojiWithTier('Miete').tier).toBe(1)        // exact
    expect(lookupEmojiWithTier('Miete Berlin').tier).toBe(2) // substring (miete)
    expect(lookupEmojiWithTier('smile').tier).toBe(3)        // emojilib
    expect(lookupEmojiWithTier('qwertzu').tier).toBe(4)      // default
  })
})

describe('useEmojiLookup — Cache-Reset', () => {
  it('__resetEmojiLookupCache erlaubt Test-Isolation', () => {
    __resetEmojiLookupCache()
    const { lookupEmoji } = useEmojiLookup()
    expect(lookupEmoji('Miete')).toBe('🏠')
    __resetEmojiLookupCache()
    // Nach Reset: gleicher Lookup, andere Cache-Instanz — Ergebnis identisch.
    const { lookupEmoji: lookup2 } = useEmojiLookup()
    expect(lookup2('Miete')).toBe('🏠')
  })
})