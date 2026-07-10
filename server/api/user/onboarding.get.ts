/*
 * GET /api/user/onboarding
 *
 * Liefert den Onboarding-Tour-State des aktuellen Users.
 * `completedSteps`: Array von Step-IDs, die der User bereits abgeschlossen hat.
 * `skipped`: User hat explizit "Setup später" gewählt → kein Auto-Trigger mehr.
 *
 * Wird vom `useOnboarding`-Composable nach Login aufgerufen, um den
 * lokalen State zu initialisieren.
 */
import { defineEventHandler } from 'h3'
import { prisma } from '../../utils/prisma'
import { requireAuthenticatedUser } from '../../utils/household-access'
import { defineApiResponse } from '../../utils/api-response'

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      onboardingCompletedSteps: true,
      onboardingSkipped: true,
    },
  })

  return defineApiResponse({
    completedSteps: row?.onboardingCompletedSteps ?? [],
    skipped: row?.onboardingSkipped ?? false,
  })
})