/*
 * PATCH /api/households/:householdId/accounts/default
 *
 * Setzt das eigene Standardkonto (ADR-0006, issue #190): vorausgewaehlt bei
 * Umschlaegen ohne Kontobindung.
 *
 * Body: { accountId: string | null }
 *
 * Auth: `requireHouseholdMembership` — jedes Mitglied stellt nur sein
 * eigenes ein.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdMembership } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { setDefaultAccount } from '../../../../utils/accounts'

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const { user } = await requireHouseholdMembership(event, householdId)

  const body = (await readBody<{ accountId?: unknown }>(event)) ?? {}
  const accountId = body.accountId ?? null
  if (accountId !== null && (typeof accountId !== 'string' || !accountId)) {
    throw createError({ statusCode: 400, statusMessage: 'accountId must be an account id or null.' })
  }

  return defineApiResponse(await setDefaultAccount(householdId, user.id, accountId))
})
