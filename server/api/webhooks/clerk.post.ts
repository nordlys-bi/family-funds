import { Webhook } from 'svix'
import { defineEventHandler, createError, getHeader, readRawBody } from 'h3'
import { prisma } from '../../utils/prisma'
import { syncClerkUser } from '../../utils/clerk-sync'

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

  return {
    success: true,
    ignored: true,
    event: evt.type,
  }
})
