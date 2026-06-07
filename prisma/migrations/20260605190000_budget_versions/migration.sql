-- AlterEnum
ALTER TYPE "Frequency" ADD VALUE IF NOT EXISTS 'WEEKLY';

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN "key" TEXT;

-- Backfill existing budgets with stable keys and initial versions
UPDATE "Budget"
SET "key" = 'budget_' || substring(replace("id"::text, '-', ''), 1, 16)
WHERE "key" IS NULL;

INSERT INTO "BudgetVersion" ("id", "budgetId", "amount", "frequency", "validFrom", "createdAt", "updatedAt")
SELECT
    "id",
    "id",
    "amount",
    'MONTHLY'::"Frequency",
    date_trunc('month', COALESCE("startDate", "createdAt")),
    "createdAt",
    "updatedAt"
FROM "Budget";

ALTER TABLE "Budget" ALTER COLUMN "key" SET NOT NULL;

-- Drop obsolete period columns from the legacy budget model
ALTER TABLE "Budget" DROP COLUMN "amount",
DROP COLUMN "startDate",
DROP COLUMN "endDate";

-- CreateIndex
CREATE UNIQUE INDEX "Budget_householdId_key_key" ON "Budget"("householdId", "key");
CREATE INDEX "Budget_householdId_key_idx" ON "Budget"("householdId", "key");
CREATE UNIQUE INDEX "BudgetVersion_budgetId_validFrom_key" ON "BudgetVersion"("budgetId", "validFrom");
CREATE INDEX "BudgetVersion_budgetId_validFrom_idx" ON "BudgetVersion"("budgetId", "validFrom");
CREATE INDEX "BudgetVersion_validFrom_idx" ON "BudgetVersion"("validFrom");

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
