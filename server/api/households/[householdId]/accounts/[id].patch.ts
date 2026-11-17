/*
 * PATCH /api/households/:householdId/accounts/:id
 *
 * Body (alle optional): { name, type, openingBalance, closedAt: 'YYYY-MM-DD' | null }
 * `closedAt: null` oeffnet das Konto wieder. Das Startdatum ist fest.
 *
 * Auth: `requireHouseholdOwner`.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { requireHouseholdOwner } from '../../../../utils/household-access'
import { defineApiResponse } from '../../../../utils/api-response'
import { parseUuidParam } from '../../../../utils/validation'
import { parseDateInput } from '../../../../utils/planning'
import { parseSignedMoney } from '../../../../utils/envelope-lifecycle'
import { parseAccountType, updateAccount, type AccountChanges } from '../../../../utils/accounts'

type UpdateAccountBody = {
  name?: string
  type?: string
  openingBalance?: string | number
  closedAt?: string | null
}

export default defineEventHandler(async (event) => {
  const householdId = parseUuidParam(event, 'householdId')
  const id = parseUuidParam(event, 'id')
  await requireHouseholdOwner(event, householdId)

  const body = (await readBody<UpdateAccountBody>(event)) ?? {}
  const changes: AccountChanges = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required.' })
    changes.name = name
  }
  if (body.type !== undefined) changes.type = parseAccountType(body.type)
  if (body.openingBalance !== undefined) changes.openingBalance = parseSignedMoney(body.openingBalance, 'Opening balance')
  if (body.closedAt !== undefined) changes.closedAt = body.closedAt === null ? null : parseDateInput(body.closedAt, 'Closing date')
  if (Object.keys(changes).length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to update.' })

  const item = await updateAccount(householdId, id, changes)
  return defineApiResponse({ kind: 'account', item })
})
