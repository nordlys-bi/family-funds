import { Webhook } from 'svix'
import { defineEventHandler, createError, getHeader, readRawBody } from 'h3'
import { prisma } from '../../utils/prisma'
import { syncClerkUser } from '../../utils/clerk-sync'
import { deleteUserByOidcSubject } from '../../utils/gdpr-delete'

type ClerkWebhookEvent = {
  type: string
  data: Record<string, unknown>
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const webhookSecret = config.clerkWebhookSecret

  if (!webhookSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'CLERK_WEBHOOK_SECRET is not configured',
    })
  }

  const payload = await readRawBody(event)
  if (!payload) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Webhook payload is missing',
    })
  }

  const rawPayload = typeof payload === 'string' ? payload : payload.toString('utf8')

  const svixHeaders = {
    'svix-id': getHeader(event, 'svix-id'),
    'svix-timestamp': getHeader(event, 'svix-timestamp'),
    'svix-signature': getHeader(event, 'svix-signature'),
  }

  if (!svixHeaders['svix-id'] || !svixHeaders['svix-timestamp'] || !svixHeaders['svix-signature']) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing Svix headers',
    })
  }

  const webhook = new Webhook(webhookSecret)

  let evt: ClerkWebhookEvent
  try {
    evt = webhook.verify(rawPayload, svixHeaders as Record<string, string>) as ClerkWebhookEvent
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid Clerk webhook signature',
    })
  }

  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const user = await syncClerkUser(prisma, evt.data as any)
    return {
      success: true,
      event: evt.type,
      userId: user.id,
    }
  }

  // DSGVO Art. 17 — User-Loeschung wird vom Webhook ausgeloest, sobald der
  // User bei Clerk sein Konto loescht. Wir muessen den lokalen User mitsamt
  // Cascade-Rows (Memberships, Incomes, Expenses, Invitations) loeschen.
  // Falls er alleiniger OWNER einer Household war, loeschen wir die
  // Household ebenfalls (DSGVO hat hoehere Prioritaet als die
  // "Haushalt braucht OWNER"-Constraint).
  if (evt.type === 'user.deleted') {
    const oidcSubject = (evt.data as any)?.id
    if (!oidcSubject || typeof oidcSubject !== 'string') {
      return {
        success: true,
        ignored: true,
        event: evt.type,
        reason: 'missing-oidc-subject',
      }
    }

    const result = await deleteUserByOidcSubject(prisma, oidcSubject)

    if (!result.deleted) {
      // Idempotent: User existiert nicht (mehr) — kein 500, sondern
      // 200 ignored. Clerk re-delivers bei 5xx, wir quittieren mit 200.
      return {
        success: true,
        ignored: true,
        event: evt.type,
        reason: result.reason,
      }
    }

    return {
      success: true,
      event: evt.type,
      userId: result.userId,
      cascadeDeletedHouseholds: result.cascadeDeletedHouseholds,
    }
  }

  return {
    success: true,
    ignored: true,
    event: evt.type,
  }
})
