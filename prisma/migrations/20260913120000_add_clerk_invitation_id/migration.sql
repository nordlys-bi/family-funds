-- AlterTable
ALTER TABLE "HouseholdInvitation" ADD COLUMN "clerkInvitationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdInvitation_clerkInvitationId_key" ON "HouseholdInvitation"("clerkInvitationId");
