import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'

/**
 * Verschickt eine Clerk-Invitation-Mail fuer `email`. Der Invitation-Link
 * fuehrt zurueck auf `/login`, wo `<SignIn>` (siehe ClerkLoginCard.vue) den
 * `__clerk_ticket` Query-Param automatisch erkennt und den Sign-up abschliesst.
 *
 * Gibt die Clerk-Invitation-ID zurueck, oder `null` wenn Clerk bereits eine
 * offene Invitation fuer diese E-Mail hat (kein Fehler, einfach kein erneuter
 * Versand noetig).
 */
export async function sendClerkInvitation(event: H3Event, email: string): Promise<string | null> {
  const { clerkClient } = await import('@clerk/nuxt/server')
  const redirectUrl = new URL('/login', getRequestURL(event).origin).toString()

  try {
    const invitation = await clerkClient(event).invitations.createInvitation({
      emailAddress: email,
      redirectUrl,
    })
    return invitation.id
  } catch (error: any) {
    const isDuplicate = error?.status === 422
      || error?.errors?.some((e: any) => e.code === 'duplicate_record')
    if (isDuplicate) return null
    throw error
  }
}

/**
 * Widerruft eine Clerk-Invitation, damit ein zurueckgezogener Einladungslink
 * nicht mehr funktioniert. Ist die Invitation bei Clerk bereits akzeptiert
 * oder widerrufen, ist das kein Fehler (idempotent).
 */
export async function revokeClerkInvitation(event: H3Event, clerkInvitationId: string): Promise<void> {
  const { clerkClient } = await import('@clerk/nuxt/server')

  try {
    await clerkClient(event).invitations.revokeInvitation(clerkInvitationId)
  } catch (error: any) {
    if (error?.status === 404 || error?.status === 400) return
    throw error
  }
}
