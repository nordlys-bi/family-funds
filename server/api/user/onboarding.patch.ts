/*
 * PATCH /api/user/onboarding
 *
 * Aktualisiert den Onboarding-Tour-State des aktuellen Users.
 * Body (alle Felder optional, idempotent):
 *   { completedSteps?: string[], skipped?: boolean }
 *
 * Wird vom `useOnboarding`-Composable nach jedem Step-Complete / Skip
 * aufgerufen, damit der State den Reload ueberlebt.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireAuthenticatedUser } from '../../utils/household-access'
import { defineApiResponse } from '../../utils/api-response'

// Whitelist der erlaubten Step-IDs — schuetzt vor Client-Injection
// (User koennte sonst beliebige Strings persistieren).
const ALLOWED_STEPS = ['household', 'invite', 'budget', 'transaction'] as const
type OnboardingStep = (typeof ALLOWED_STEPS)[number]

type PatchBody = {
  completedSteps?: string[]
  skipped?: boolean
}

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<PatchBody>(event)

  const completedSteps = Array.isArray(body.completedSteps)
    ? body.completedSteps.filter((step): step is OnboardingStep =>
        ALLOWED_STEPS.includes(step as OnboardingStep),
      )
    : undefined

  const skipped = typeof body.skipped === 'boolean' ? body.skipped : undefined

  if (completedSteps === undefined && skipped === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one of completedSteps/skipped must be provided.',
    })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(completedSteps !== undefined ? { onboardingCompletedSteps: completedSteps } : {}),
      ...(skipped !== undefined ? { onboardingSkipped: skipped } : {}),
    },
    select: {
      onboardingCompletedSteps: true,
      onboardingSkipped: true,
    },
  })

  return defineApiResponse({
    completedSteps: updated.onboardingCompletedSteps,
    skipped: updated.onboardingSkipped,
  })
})