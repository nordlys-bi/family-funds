/*
 * GDPR-konforme User-Loeschung.
 *
 * Wird vom Clerk-Webhook (`evt.type === 'user.deleted'`) aufgerufen und
 * loescht den lokalen User mitsamt allen Cascade-Rows. CONTEXT.md
 * fordert vollstaendige Loeschung auf Wunsch des Users (DSGVO Art. 17).
 *
 * Spezialfall "sole OWNER": Eine Household-Sperre "mindestens ein OWNER
 * pro Haushalt" gilt im Tagesbetrieb. Wenn aber ein User per GDPR-
 * Loeschung geloescht wird, koennen wir nicht ablehnen — er hat das
 * Recht auf Loeschung ausgeuebt. In diesem Fall loeschen wir die
 * Households, wo er alleiniger OWNER war, vollstaendig (Cascade
 * zu Budgets, Transaktionen, Sparzielen etc.). Households mit
 * weiteren OWNERn oder reine MEMBER-Haushalte verlieren nur die
 * Membership des geloeschten Users.
 *
 * Idempotent: Wenn der User bereits nicht existiert, liefern wir 200
 * `ignored: true` (Clerk akzeptiert das und re-delivers nicht).
 */

import { Role, type PrismaClient } from '@prisma/client'

export interface GdprDeleteResult {
  userId: string | null
  deleted: boolean
  cascadeDeletedHouseholds: string[]
  reason: 'not-found' | 'deleted'
}

/**
 * Loescht einen User per oidcSubject. Cascade-Deletes seine Memberships,
 * Expensen, Incomes, Invitations. Wenn er alleiniger OWNER einer
 * Household ist, wird die Household ebenfalls vollstaendig geloescht.
 */
export async function deleteUserByOidcSubject(
  prisma: PrismaClient,
  oidcSubject: string,
): Promise<GdprDeleteResult> {
  const user = await prisma.user.findUnique({
    where: { oidcSubject },
    select: {
      id: true,
      memberships: {
        select: {
          id: true,
          role: true,
          householdId: true,
        },
      },
    },
  })

  if (!user) {
    return { userId: null, deleted: false, cascadeDeletedHouseholds: [], reason: 'not-found' }
  }

  const cascadeDeletedHouseholds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const membership of user.memberships) {
      if (membership.role !== Role.OWNER) continue

      const ownerCount = await tx.householdMember.count({
        where: { householdId: membership.householdId, role: Role.OWNER },
      })

      if (ownerCount <= 1) {
        // Sole-Owner-Fall: gesamte Household loeschen, nicht nur die Membership.
        await tx.household.delete({ where: { id: membership.householdId } })
        cascadeDeletedHouseholds.push(membership.householdId)
      }
    }

    // Memberships, Incomes, Expenses, Invitations: Cascade via schema.
    // Wir fuehren bewusst keinen App-Layer-Cleanup durch.
    await tx.user.delete({ where: { id: user.id } })
  })

  console.log(
    JSON.stringify({
      audit: 'gdpr-user-deleted',
      userId: user.id,
      oidcSubject,
      membershipsBefore: user.memberships.length,
      cascadeDeletedHouseholds,
      timestamp: new Date().toISOString(),
    }),
  )

  return {
    userId: user.id,
    deleted: true,
    cascadeDeletedHouseholds,
    reason: 'deleted',
  }
}
