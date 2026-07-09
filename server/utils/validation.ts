/*
 * Validation helpers for server-side request inputs.
 *
 * Single-Source-of-Truth für wiederkehrende Validierungs-Patterns.
 * Endpoint-Files rufen diese Helper als erstes nach Auth-Check auf —
 * keine direkten `event.context.params?.xy`-Reads in Prisma-Queries.
 */

import { createError, getRouterParam, type H3Event } from 'h3'

// RFC 4122 v4-UUID (alle Prisma-Modelle nutzen @default(uuid()))
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Liest einen UUID-Path-Parameter aus `event.context.params` und prüft das Format.
 *
 * Wirft `400 Bad Request`, wenn der Param fehlt oder kein gültiges UUID-Format hat
 * (statt den Wert an Prisma weiterzureichen, das dann P2002/P2019 wirft und Stack-
 * Details leakt — siehe Backend-Review Finding #12).
 */
export function parseUuidParam(event: H3Event, paramName: string): string {
  const value = getRouterParam(event, paramName)

  if (!value) {
    throw createError({
      statusCode: 400,
      statusMessage: `Missing required path parameter: ${paramName}`,
    })
  }

  if (!UUID_V4_REGEX.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid ${paramName}: must be a UUID`,
    })
  }

  return value
}
