/*
 * Globaler Error-Handler (Nitro Plugin).
 *
 * Fängt unbehandelte Errors aus API-Endpoints ab und maskiert Stack-Traces
 * & interne Meldungen vom Client. Statt eines detaillierten Prisma-/
 * h3-Errors bekommt der Client einheitlich eine generische Message.
 *
 * Konsistent mit Backend-Review Finding #12 (Error-Leak).
 *
 * Hook-Punkt: `nitroApp.hooks.hook('error', ...)` — die einzige Stelle,
 * an der ALLE unhandled Errors ankommen (inkl. createError({statusCode: ...})).
 */

import { defineNitroPlugin } from 'nitropack/runtime'
import { Prisma } from '@prisma/client'

/**
 * Erkennt Prisma-Detail-Messages, die wir nicht zum Client durchlassen wollen.
 * Beispiele: "P2002: ...", "Invalid `prisma.foo.create()` invocation: ..."
 */
function looksLikePrismaDetail(message: string | undefined): boolean {
  if (!message) return false
  return (
    /\bP\d{4}\b/.test(message) ||
    /Invalid `prisma\./.test(message) ||
    /Unknown argument/.test(message) ||
    /prisma:error/i.test(message)
  )
}

function getStatusCode(error: unknown): number {
  const e = error as { statusCode?: number; status?: number }
  return typeof e.statusCode === 'number'
    ? e.statusCode
    : typeof e.status === 'number'
    ? e.status
    : 500
}

interface MutableError {
  statusCode?: number
  statusMessage?: string
  message?: string
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, ctx) => {
    const event = ctx?.event
    const status = getStatusCode(error)
    const isPrisma = error instanceof Prisma.PrismaClientKnownRequestError

    // Strukturiertes Logging — bei Bedarf später an pino/Sentry hängen.
    console.error('[api-error]', {
      status,
      url: event?.node?.req?.url,
      method: event?.node?.req?.method,
      class: error?.constructor?.name,
      prismaCode: isPrisma ? (error as { code: string }).code : undefined,
      message: (error as { message?: string })?.message,
    })

    // Sanitization: Prisma-Detail-Messages nie zum Client durchlassen,
    // egal ob 4xx oder 5xx. Sonst stehen Schemadetails im Browser.
    const message = (error as { message?: string })?.message
    if (event && looksLikePrismaDetail(message)) {
      const mutable = error as MutableError
      mutable.statusCode = 400
      mutable.statusMessage = 'Invalid request'
      mutable.message = 'Invalid request'
    }
  })
})
