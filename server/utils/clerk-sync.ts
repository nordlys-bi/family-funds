import { Role, type PrismaClient } from '@prisma/client'

type ClerkEmailAddress = {
  id?: string
  email_address?: string
  emailAddress?: string
}

type ClerkUserSource = {
  id: string
  email_addresses?: ClerkEmailAddress[]
  emailAddresses?: ClerkEmailAddress[]
  primary_email_address_id?: string | null
  primaryEmailAddressId?: string | null
  first_name?: string | null
  firstName?: string | null
  last_name?: string | null
  lastName?: string | null
  username?: string | null
}

function getClerkEmailAddresses(clerkUser: ClerkUserSource): ClerkEmailAddress[] {
  return clerkUser.email_addresses || clerkUser.emailAddresses || []
}

function getClerkPrimaryEmailId(clerkUser: ClerkUserSource): string | null {
  return clerkUser.primary_email_address_id || clerkUser.primaryEmailAddressId || null
}

function getClerkDisplayName(clerkUser: ClerkUserSource): string | null {
  const firstName = clerkUser.first_name || clerkUser.firstName || ''
  const lastName = clerkUser.last_name || clerkUser.lastName || ''
  const fullName = `${firstName} ${lastName}`.trim()
  if (fullName) return fullName
  return clerkUser.username || null
}

function getClerkEmail(clerkUser: ClerkUserSource): string {
  const emailAddresses = getClerkEmailAddresses(clerkUser)
  const primaryEmailId = getClerkPrimaryEmailId(clerkUser)

  const primaryEmail = emailAddresses.find((email) => email.id === primaryEmailId)
  if (primaryEmail?.email_address) return primaryEmail.email_address.toLowerCase()
  if (primaryEmail?.emailAddress) return primaryEmail.emailAddress.toLowerCase()

  const firstEmail = emailAddresses[0]
  if (firstEmail?.email_address) return firstEmail.email_address.toLowerCase()
  if (firstEmail?.emailAddress) return firstEmail.emailAddress.toLowerCase()

  return (clerkUser.username || '').toLowerCase()
}

function getDefaultHouseholdName(displayName: string | null, email: string): string {
  if (displayName) {
    return `Haushalt von ${displayName}`
  }

  const localPart = email.split('@')[0]
  if (localPart) {
    return `Haushalt von ${localPart}`
  }

  return 'Mein Haushalt'
}

export async function syncClerkUser(
  prisma: PrismaClient,
  clerkUser: ClerkUserSource,
  options?: {
    createDefaultHousehold?: boolean
  },
) {
  const email = getClerkEmail(clerkUser)
  const displayName = getClerkDisplayName(clerkUser)

  const user = await prisma.user.upsert({
    where: { oidcSubject: clerkUser.id },
    create: {
      oidcSubject: clerkUser.id,
      email,
      displayName,
    },
    update: {
      email,
      displayName,
    },
  })

  const pendingInvitations = await prisma.householdInvitation.findMany({
    where: {
      email,
      acceptedAt: null,
    },
  })

  if (pendingInvitations.length > 0) {
    const invitationIds = pendingInvitations.map((invitation) => invitation.id)

    await prisma.$transaction([
      prisma.householdMember.createMany({
        data: pendingInvitations.map((invitation) => ({
          userId: user.id,
          householdId: invitation.householdId,
          role: invitation.role,
        })),
        skipDuplicates: true,
      }),
      prisma.householdInvitation.updateMany({
        where: {
          id: { in: invitationIds },
        },
        data: {
          acceptedAt: new Date(),
        },
      }),
    ])
  }

  const shouldCreateDefaultHousehold = options?.createDefaultHousehold !== false

  if (shouldCreateDefaultHousehold) {
    const membershipCount = await prisma.householdMember.count({
      where: { userId: user.id },
    })

    if (membershipCount === 0 && pendingInvitations.length === 0) {
      const household = await prisma.household.create({
        data: {
          name: getDefaultHouseholdName(displayName, email),
        },
      })

      await prisma.householdMember.create({
        data: {
          userId: user.id,
          householdId: household.id,
          role: Role.OWNER,
        },
      })
    }
  }

  return user
}
