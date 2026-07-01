import { createError } from 'h3'
import { Role, type PrismaClient } from '@prisma/client'

/**
 * Enforces the CONTEXT.md constraint "Ein Haushalt ohne OWNER ist nicht erlaubt".
 *
 * Call this before any action that would reduce the OWNER count of a household:
 *   - deleting an OWNER's `HouseholdMember` row, or
 *   - demoting an OWNER to MEMBER.
 *
 * Throws 400 if removing/demoting the given membership would leave the
 * household with zero OWNERs. Returns silently if the membership is not
 * an OWNER, does not exist, or does not belong to the given household
 * (in which case the constraint is not applicable to this call).
 */
export async function assertCanRemoveOrDemoteOwner(
  prisma: PrismaClient,
  householdId: string,
  membershipId: string,
): Promise<void> {
  const membership = await prisma.householdMember.findUnique({
    where: { id: membershipId },
    select: { role: true, householdId: true },
  })

  // Constraint only applies if we're touching an OWNER of THIS household.
  if (!membership || membership.householdId !== householdId) return
  if (membership.role !== Role.OWNER) return

  const ownerCount = await prisma.householdMember.count({
    where: { householdId, role: Role.OWNER },
  })

  if (ownerCount <= 1) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'A household must have at least one owner. Promote another member to OWNER first, or delete the household instead.',
    })
  }
}