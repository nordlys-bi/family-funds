/*
 * Kuratierte Emoji-Domain-Map fuer Family-Funds (issue #8).
 *
 * Wird im Emoji-Lookup als Prioritaets-Stufe 1+2 genutzt:
 *   1. Exact-Match (case-insensitive)
 *   2. Substring-Match (z. B. "Rechnung Strom" matcht "strom")
 *
 * Bewusst klein gehalten (~30 Eintraege) und nur fuer Begriffe, die
 * in Family-Funds tatsaechlich haeufig als Name vorkommen (Budgets,
 * Sparziele, Buchungs-Beschreibungen). Was hier nicht steht, faellt
 * durch auf emojilib (Stufe 3) oder den Default-Fallback (Stufe 4).
 *
 * Neue Begriffe: hier hinzufuegen, kein separater Pflege-UI noetig
 * (Issue-Out-of-Scope). Wenn die Liste ueber 60+ waechst, sollte man
 * in eine Config-Datei oder DB wechseln.
 *
 * Keys sind lowercase, Values sind Unicode-Emojis. Sortierung ist
 * absichtlich nicht spezifiziert — die Reihenfolge der Eintraegung
 * entspricht der Reihenfolge in der Map (Iteration-Order = Insertion-Order).
 */

export type EmojiDomainMap = Readonly<Record<string, string>>

export const emojiDomainMap: EmojiDomainMap = Object.freeze({
  // Wohnen / Haushalt
  miete: '🏠',
  wohnung: '🏠',
  haus: '🏠',
  strom: '⚡',
  gas: '🔥',
  heizung: '🔥',
  wasser: '💧',
  internet: '🌐',
  wlan: '🌐',
  handy: '📱',
  telefon: '📞',

  // Einkauf / Lebensmittel
  lebensmittel: '🛒',
  einkauf: '🛒',
  wocheneinkauf: '🛒',
  supermarkt: '🛒',
  rewe: '🛒',
  edeka: '🛒',
  aldi: '🛒',
  lidl: '🛒',
  restaurant: '🍽️',
  lieferando: '🛵',
  lieferung: '🛵',
  essen: '🍽️',
  cafe: '☕',
  kaffee: '☕',

  // Einnahmen
  gehalt: '💰',
  lohn: '💰',
  bonus: '🎁',
  rente: '🏦',
  pension: '🏦',

  // Transport
  tanken: '⛽',
  benzin: '⛽',
  diesel: '⛽',
  sprit: '⛽',
  öpnv: '🚇',
  bus: '🚌',
  bahn: '🚆',
  zug: '🚆',
  flug: '✈️',
  flugzeug: '✈️',
  taxi: '🚕',
  auto: '🚗',

  // Medien / Abos
  streaming: '📺',
  netflix: '🎬',
  spotify: '🎵',
  musik: '🎵',
  film: '🎬',
  kino: '🎬',

  // Gesundheit
  apotheke: '💊',
  arzt: '🩺',
  zahnarzt: '🦷',
  fitness: '🏋️',
  sport: '🏋️',
  yoga: '🧘',

  // Versicherung / Steuern
  versicherung: '🛡️',
  steuern: '🧾',
  finanzamt: '🧾',

  // Freizeit / Sonstiges
  urlaub: '🏖️',
  reise: '✈️',
  geschenk: '🎁',
  spende: '❤️',
  kind: '👶',
  kinder: '👶',
  familie: '👨‍👩‍👧‍👦',
  haustier: '🐾',
  hund: '🐶',
  katze: '🐱',
  buch: '📚',
  bücher: '📚',
  spiel: '🎲',
})

/**
 * Default-Emoji wenn kein Lookup-Treffer.
 *
 * 💸 ist semantisch neutral ("Geld-Transaktion ohne Kategorie"),
 * visuell dezent und in allen modernen Font-Stacks verfuegbar.
 * Issue-Acceptance-Kriterium: dokumentiert und im Repo committed.
 */
export const DEFAULT_EMOJI = '💸'