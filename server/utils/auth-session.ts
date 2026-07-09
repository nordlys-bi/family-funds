/*
 * Session-Cookie-Helpers fuer die Mock-Auth.
 *
 * Warum HMAC-signiert? Vorher war die Cookie der rohe user-UUID-String
 * — bei DB-Lesezugriff (Backup, Replica, Log-Leak) konnte jeder
 * beliebige User impersoniert werden, indem die UUID in den Cookie
 * gesetzt wurde. Jetzt ist die Cookie ein HMAC-signierter Token:
 *   Cookie-Wert: `${base64url(userId + "." + issuedAt)}.${base64url(HMAC-SHA256(payload, NUXT_SESSION_SECRET))}`
 *
 * Cookie-Name: `__Host-session`. Per RFC 6265bis verlangt der
 * `__Host-`-Prefix zwingend: `Secure`, `Path=/`, kein `Domain`.
 * Wir setzen `secure: true` immer (nicht env-abhaengig).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'

const COOKIE_NAME = '__Host-session'
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
const MIN_SECRET_LENGTH = 32

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

let cachedSecret: string | null = null

/**
 * Liest das HMAC-Secret aus `NUXT_SESSION_SECRET`. Faellt im Dev-Mode
 * auf einen hartcodierten Platzhalter zurueck (mit lautem Warn-Log);
 * im Production-Mode wirft sie, damit die App nicht versehentlich mit
 * unsicherer Cookie startet.
 */
function getSessionSecret(): string {
  if (cachedSecret !== null) return cachedSecret

  const envSecret = process.env.NUXT_SESSION_SECRET
  if (envSecret && envSecret.length >= MIN_SECRET_LENGTH) {
    cachedSecret = envSecret
    return cachedSecret
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[auth-session] NUXT_SESSION_SECRET ist erforderlich in production ' +
      `(min ${MIN_SECRET_LENGTH} Zeichen). Session-Cookies waeren sonst forge-bar.`,
    )
  }

  // Dev-Fallback.
  console.warn(
    '[auth-session] WARN: NUXT_SESSION_SECRET nicht gesetzt — verwende ' +
    'Dev-Fallback. Nicht fuer Production geeignet. Cookies sind NICHT ' +
    'kryptografisch signiert in diesem Modus.',
  )
  cachedSecret = 'dev-only-fallback-secret-do-not-use-in-prod-32'
  return cachedSecret
}

/** Erlaubt Tests, das gecachte Secret zurueckzusetzen. */
export function _resetSessionSecretCacheForTests(): void {
  cachedSecret = null
}

// ---------------------------------------------------------------------------
// Token: encode / sign / verify
// ---------------------------------------------------------------------------

function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

export interface SessionToken {
  userId: string
  /** Unix-Sekunden, in denen das Token ausgestellt wurde. */
  issuedAt: number
}

/**
 * Erzeugt einen signierten Session-Token fuer `userId`. Payload-Format:
 *   `${base64url(userId + "." + issuedAt)}.${base64url(HMAC)}`
 *
 * Beide Teile sind base64url, sodass die Cookie keine problematischen
 * Zeichen enthaelt (Kolon etc.). userId ist eine UUID ohne Punkte, das
 * Splitten beim Verifizieren ist eindeutig via `lastIndexOf(".")`.
 */
export function signSessionToken(
  userId: string,
  nowMs: number = Date.now(),
): string {
  if (!userId || userId.includes('.')) {
    throw new Error('[auth-session] signSessionToken: userId darf keinen Punkt enthalten')
  }
  const issuedAt = Math.floor(nowMs / 1000)
  const payload = base64urlEncode(`${userId}.${issuedAt}`)
  const signature = createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest()
  return `${payload}.${base64urlEncode(signature)}`
}

/**
 * Verifiziert den Token, liefert `{ userId, issuedAt }` bei Erfolg,
 * `null` bei:
 *  - malformed Format
 *  - Signatur-Mismatch (forged cookie / falscher secret)
 *  - abgelaufenem `issuedAt` (aelter als `maxAgeSeconds`)
 */
export function verifySessionToken(
  token: string,
  nowMs: number = Date.now(),
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): SessionToken | null {
  if (typeof token !== 'string' || token.length === 0) return null

  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null

  const payload = token.slice(0, dotIndex)
  const signaturePart = token.slice(dotIndex + 1)

  let signature: Buffer
  try {
    signature = base64urlDecode(signaturePart)
  } catch {
    return null
  }

  const expected = createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest()
  // timingSafeEqual verlangt gleiche Laenge — sonst Crash. safeEqual macht
  // den Laengen-Check vor dem Vergleich und gibt false zurueck.
  if (!safeEqual(expected, signature)) return null

  let decoded: string
  try {
    decoded = base64urlDecode(payload).toString('utf8')
  } catch {
    return null
  }

  const sepIndex = decoded.lastIndexOf('.')
  if (sepIndex <= 0) return null

  const userId = decoded.slice(0, sepIndex)
  const issuedAtStr = decoded.slice(sepIndex + 1)
  const issuedAt = Number.parseInt(issuedAtStr, 10)
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null

  if (nowMs / 1000 - issuedAt > maxAgeSeconds) return null

  return { userId, issuedAt }
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Cookie-Helpers (Request/Response)
// ---------------------------------------------------------------------------

/** Setzt die signierte Session-Cookie auf dem aktuellen Response. */
export function issueSessionCookie(event: H3Event, userId: string): void {
  const token = signSessionToken(userId)
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true, // immer — `__Host-`-Prefix verlangt das sowieso
    sameSite: 'lax',
    path: '/',
    maxAge: DEFAULT_MAX_AGE_SECONDS,
  })
}

/** Loescht die Session-Cookie. */
export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, COOKIE_NAME, {
    path: '/',
    secure: true,
  })
}

/**
 * Liest + verifiziert die Session-Cookie. Liefert die User-ID bei
 * Erfolg, `null` bei fehlender / ungueltiger / abgelaufener Cookie.
 */
export function getSessionUserId(event: H3Event): string | null {
  const token = getCookie(event, COOKIE_NAME)
  if (!token) return null
  const session = verifySessionToken(token)
  return session?.userId ?? null
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
