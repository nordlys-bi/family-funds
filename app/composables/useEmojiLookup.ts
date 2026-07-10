/*
 * useEmojiLookup — Emoji-Lookup-Composable (issue #8).
 *
 * Deterministische, offline-faehige Suche nach einem passenden Emoji
 * fuer einen frei formulierten Begriff. Keine LLM/AI-Calls, kein
 * Netzwerk-Roundtrip — komplett deterministisch und synchron.
 *
 * Priority-Chain (Reihenfolge ist wichtig):
 *   1. Exact-Match in Domain-Map (case-insensitive)
 *      → "Miete" liefert 🏠
 *   2. Substring-Match in Domain-Map (substring des Suchbegriffs matched Key)
 *      → "Rechnung Strom" liefert ⚡ (weil "strom" enthalten ist)
 *      → Substring ist NUR erfolgreich, wenn das Substring >= 3 Zeichen hat
 *        und der vollstaendige Domain-Key in der Such-Term-String passt.
 *   3. emojilib-Lookup (Keyword → Emoji)
 *      → emojilib ist invertiert (emoji → keywords); wir bauen den
 *        invertierten Index einmalig beim ersten Lookup auf.
 *   4. Default-Fallback (💸)
 *
 * Warum Composable und nicht pure function?
 *   - emojilib-Inversion-Index wird lazy + gecached pro Composable-Instanz
 *   - Tests koennen den Index resetten
 *   - spaeter kann das Composable auch User-spezifische Overrides halten
 *
 * Verwendung:
 *   const { lookupEmoji } = useEmojiLookup()
 *   lookupEmoji('Miete')           // '🏠'
 *   lookupEmoji('Rechnung Strom')  // '⚡'
 *   lookupEmoji('Urlaub 2026')     // '🏖️'
 *   lookupEmoji('xyz123')          // '💸'  (Default-Fallback)
 */
import { emojiDomainMap, DEFAULT_EMOJI } from '../utils/emojiDomainMap'

/**
 * Minimal-Laenge fuer Substring-Match in Stufe 2. Verhindert dass
 * zu kurze Woertli wie "in" oder "ei" hunderte Domain-Keys matchen.
 */
const SUBSTRING_MIN_LENGTH = 3

/**
 * emojilib ist `emoji → keywords[]`. Wir invertieren zu
 * `keyword → emoji` und nutzen das als Prioritaets-Stufe 3.
 *
 * Lookup-Strategie in der invertierten Map: erstes Keyword-Match gewinnt.
 * Bei mehreren Treffern fuer denselben Keyword nehmen wir den ersten,
 * weil emojilib die Emoji-Liste bereits nach "Hauptbedeutung" ordnet.
 */
let invertedEmojilib: Map<string, string> | null = null

function buildInvertedEmojilib(): Map<string, string> {
  // emojilib ist CommonJS (default-Export ist die Map). Im Nuxt/Vite-
  // ESM-Kontext landet es unter `.default` ODER direkt am Root — beide
  // Faelle absichern.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lib = require('emojilib') as Record<string, string[] | undefined> | { default: Record<string, string[]> }

  const emojiByKeyword: Record<string, string[]> = {}
  const raw = (lib as any).default ?? lib

  for (const emoji of Object.keys(raw)) {
    const keywords = raw[emoji]
    if (!Array.isArray(keywords)) continue
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase()
      if (!normalized) continue
      if (!emojiByKeyword[normalized]) {
        emojiByKeyword[normalized] = []
      }
      emojiByKeyword[normalized]!.push(emoji)
    }
  }

  // Erste Emoji pro Keyword ist "Hauptbedeutung" laut emojilib-Ordering.
  const map = new Map<string, string>()
  for (const [keyword, emojis] of Object.entries(emojiByKeyword)) {
    map.set(keyword, emojis[0]!)
  }
  return map
}

function getInvertedEmojilib(): Map<string, string> {
  if (invertedEmojilib === null) {
    invertedEmojilib = buildInvertedEmojilib()
  }
  return invertedEmojilib
}

/**
 * Reset fuer Tests. Im Prod-Code nie noetig.
 */
export function __resetEmojiLookupCache(): void {
  invertedEmojilib = null
}

/**
 * Normalisiert den Such-String: trim + lowercase. Sonst nichts —
 * Diakritika/Stemming wuerden mehr falsche Treffer produzieren als
 * sie nutzen (z. B. "Äpfel" vs "Apfel" — User schreibt beides mal
 * anders).
 */
function normalize(term: string): string {
  return term.trim().toLowerCase()
}

/**
 * Stufe 2: Substring-Match in der Domain-Map. Sucht nach Domain-Keys,
 * die als Substring im Such-String vorkommen.
 *
 * Iteration in Insertion-Order der Map (Object.freeze + ES2015+
 * Iteration-Semantik garantiert das). Die Reihenfolge der Eintragung
 * in `emojiDomainMap.ts` ist also die Prioritaets-Reihenfolge bei
 * Mehrfach-Matches.
 */
function findDomainSubstringMatch(normalizedTerm: string): string | null {
  for (const [key, emoji] of Object.entries(emojiDomainMap)) {
    if (key.length < SUBSTRING_MIN_LENGTH) continue
    if (normalizedTerm.includes(key)) return emoji
  }
  return null
}

export type UseEmojiLookupReturn = {
  /**
   * Lookup-Resultat fuer `term`. Liefert niemals null — bei
   * Nicht-Treffer gibt es das Default-Emoji zurueck.
   */
  lookupEmoji: (term: string) => string
  /**
   * Liefert das Tier (1-4), auf dem der Treffer gelandet ist.
   * Nuetzlich fuer Debug/Telemetry ("warum kriegt dieser Begriff
   * dieses Emoji?") und fuer Tests.
   */
  lookupEmojiWithTier: (term: string) => { emoji: string; tier: 1 | 2 | 3 | 4 }
}

export function useEmojiLookup(): UseEmojiLookupReturn {
  function lookupEmoji(term: string): string {
    return lookupEmojiWithTier(term).emoji
  }

  function lookupEmojiWithTier(term: string): { emoji: string; tier: 1 | 2 | 3 | 4 } {
    if (typeof term !== 'string' || term.trim().length === 0) {
      return { emoji: DEFAULT_EMOJI, tier: 4 }
    }

    const normalized = normalize(term)

    // Stufe 1: Exact-Match (case-insensitive).
    const exact = emojiDomainMap[normalized]
    if (exact !== undefined) {
      return { emoji: exact, tier: 1 }
    }

    // Stufe 2: Substring-Match in Domain-Map.
    const substring = findDomainSubstringMatch(normalized)
    if (substring !== null) {
      return { emoji: substring, tier: 2 }
    }

    // Stufe 3: emojilib-Lookup (Keyword → Emoji).
    const libMap = getInvertedEmojilib()
    const libMatch = libMap.get(normalized)
    if (libMatch !== undefined) {
      return { emoji: libMatch, tier: 3 }
    }

    // Stufe 4: Default-Fallback.
    return { emoji: DEFAULT_EMOJI, tier: 4 }
  }

  return {
    lookupEmoji,
    lookupEmojiWithTier,
  }
}