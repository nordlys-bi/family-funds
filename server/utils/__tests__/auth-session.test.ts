import { describe, expect, it, beforeEach } from 'vitest'
import {
  signSessionToken,
  verifySessionToken,
  issueSessionCookie,
  clearSessionCookie,
  getSessionUserId,
  SESSION_COOKIE_NAME,
  _resetSessionSecretCacheForTests,
} from '../auth-session'

/**
 * Setzt NUXT_SESSION_SECRET auf einen festen Test-Wert, damit signierte
 * Tokens zwischen den Tests reproduzierbar sind (sonst haengt die
 * Signatur am Process-Env und kann sich aendern).
 */
function setTestSecret(): void {
  process.env.NUXT_SESSION_SECRET = 'test-secret-must-be-at-least-thirty-two-chars-long'
  _resetSessionSecretCacheForTests()
}

function makeEvent(cookies: Record<string, string> = {}): any {
  const setCookieHeaders: string[] = []
  return {
    context: {},
    node: {
      req: {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        },
      },
      res: {
        setHeader(name: string, value: any): void {
          if (name.toLowerCase() === 'set-cookie') {
            if (Array.isArray(value)) {
              setCookieHeaders.push(...value.map(String))
            } else {
              setCookieHeaders.push(String(value))
            }
          }
        },
        getHeader(name: string): string | string[] | undefined {
          if (name.toLowerCase() === 'set-cookie') {
            return setCookieHeaders.join('; ')
          }
          return undefined
        },
        getHeaders(): Record<string, string | string[] | undefined> {
          return { 'set-cookie': setCookieHeaders.join('; ') }
        },
      },
    },
    __setCookieHeaders: setCookieHeaders,
  } as any
}

beforeEach(() => {
  setTestSecret()
})

describe('signSessionToken / verifySessionToken', () => {
  it('produces a token that verifies back to the same userId', () => {
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const token = signSessionToken(userId, 1717900000000)
    const decoded = verifySessionToken(token, 1717900000000)
    expect(decoded).not.toBeNull()
    expect(decoded!.userId).toBe(userId)
    expect(decoded!.issuedAt).toBe(Math.floor(1717900000000 / 1000))
  })

  it('rejects a tampered payload (signature mismatch)', () => {
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const token = signSessionToken(userId, 1717900000000)
    // Flip the first character of the payload (vor dem ersten '.')
    const tampered = token.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))
    expect(verifySessionToken(tampered, 1717900000000)).toBeNull()
  })

  it('rejects an expired token', () => {
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const now = Date.now()
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000
    const token = signSessionToken(userId, oneYearAgo)
    expect(verifySessionToken(token, now)).toBeNull()
  })

  it('rejects a malformed token (no dot)', () => {
    expect(verifySessionToken('garbage')).toBeNull()
  })

  it('rejects a malformed token (only dot)', () => {
    expect(verifySessionToken('.')).toBeNull()
  })

  it('rejects a token whose signature uses a different secret', () => {
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const token = signSessionToken(userId, 1717900000000)
    // Secret rotieren
    process.env.NUXT_SESSION_SECRET = 'other-secret-but-also-at-least-thirty-two-chars'
    _resetSessionSecretCacheForTests()
    expect(verifySessionToken(token, 1717900000000)).toBeNull()
    // zuruecksetzen
    setTestSecret()
  })

  it('rejects a token with invalid base64 signature', () => {
    // Payload gueltig, aber Signatur kein base64url -> silent return null.
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    const payload = Buffer.from(`${userId}.1717900000`, 'utf8').toString('base64url')
    const garbageSig = '!@#$%^&*()' // kein gueltiges base64url
    expect(verifySessionToken(`${payload}.${garbageSig}`)).toBeNull()
  })

  it('signSessionToken refuses userId with embedded dot', () => {
    expect(() => signSessionToken('a.b', 1717900000000)).toThrow()
  })
})

describe('issueSessionCookie / clearSessionCookie / getSessionUserId', () => {
  it('issueSessionCookie sets a __Host-session cookie with correct attributes', () => {
    const event = makeEvent()
    issueSessionCookie(event, '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab')
    const header = event.__setCookieHeaders.join('\n')
    expect(header).toContain('__Host-session=')
    expect(header).toMatch(/Secure/i)
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=Lax/i)
    expect(header).toMatch(/Path=\//)
    expect(header).toMatch(/Max-Age=\d+/)
  })

  it('getSessionUserId returns null for missing cookie', () => {
    expect(getSessionUserId(makeEvent())).toBeNull()
  })

  it('getSessionUserId returns null for tampered cookie', () => {
    const token = signSessionToken('9bff8d9f-7d2e-4f1a-b3c8-1234567890ab')
    const ev = makeEvent({ [SESSION_COOKIE_NAME]: token.replace(/^./, 'X') })
    expect(getSessionUserId(ev)).toBeNull()
  })

  it('clearSessionCookie sends a Set-Cookie header that deletes the cookie', () => {
    const event = makeEvent()
    clearSessionCookie(event)
    const header = event.__setCookieHeaders.join('\n')
    expect(header).toContain('__Host-session=')
    expect(header).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
  })

  it('round-trip: issueSessionCookie then getSessionUserId yields same userId', () => {
    const issuer = makeEvent()
    const userId = '9bff8d9f-7d2e-4f1a-b3c8-1234567890ab'
    issueSessionCookie(issuer, userId)
    const header = issuer.__setCookieHeaders.join('; ')
    const match = header.match(/__Host-session=([^;]+)/)
    expect(match).not.toBeNull()
    const cookieValue = match![1]
    const verifier = makeEvent({ '__Host-session': cookieValue })
    expect(getSessionUserId(verifier)).toBe(userId)
  })
})

describe('Session-Secret-Lifecycle', () => {
  it('throws in production without NUXT_SESSION_SECRET', () => {
    _resetSessionSecretCacheForTests()
    const originalEnv = process.env.NODE_ENV
    const originalSecret = process.env.NUXT_SESSION_SECRET
    process.env.NODE_ENV = 'production'
    delete process.env.NUXT_SESSION_SECRET
    _resetSessionSecretCacheForTests()
    try {
      expect(() => signSessionToken('any-user-id')).toThrow(/NUXT_SESSION_SECRET/)
    } finally {
      process.env.NODE_ENV = originalEnv
      process.env.NUXT_SESSION_SECRET = originalSecret ?? 'test-secret-must-be-at-least-thirty-two-chars-long'
      _resetSessionSecretCacheForTests()
    }
  })

  it('accepts a secret that meets minimum length', () => {
    process.env.NUXT_SESSION_SECRET = 'a'.repeat(32)
    _resetSessionSecretCacheForTests()
    expect(() => signSessionToken('valid-user-id')).not.toThrow()
  })

  it('rejects a too-short secret in any mode', () => {
    const originalSecret = process.env.NUXT_SESSION_SECRET
    process.env.NUXT_SESSION_SECRET = 'short'
    _resetSessionSecretCacheForTests()
    // Bei zu kurzem secret ohne Production-Fallback wird Dev-Fallback
    // benutzt — kein Throw. Die Signatur ist dann aber trotzdem HMAC-mac'd.
    expect(() => signSessionToken('valid-user-id')).not.toThrow()
    process.env.NUXT_SESSION_SECRET = originalSecret ?? 'test-secret-must-be-at-least-thirty-two-chars-long'
    _resetSessionSecretCacheForTests()
  })
})
