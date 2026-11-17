-- CreateTable
CREATE TABLE "AccountAdjustment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "statedBalance" INTEGER NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountAdjustment_householdId_date_idx" ON "AccountAdjustment"("householdId", "date");

-- CreateIndex
CREATE INDEX "AccountAdjustment_accountId_date_idx" ON "AccountAdjustment"("accountId", "date");

-- AddForeignKey
ALTER TABLE "AccountAdjustment" ADD CONSTRAINT "AccountAdjustment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAdjustment" ADD CONSTRAINT "AccountAdjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAdjustment" ADD CONSTRAINT "AccountAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
