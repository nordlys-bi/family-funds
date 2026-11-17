-- ADR-0006 (issue #188): Konten, rein additiv. Bestehende Haushalte haben
-- danach keine Konten und rechnen unveraendert wie in Stufe 1.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'CASH', 'SAVINGS');

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "primaryAccountId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseTransaction" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "HouseholdMember" ADD COLUMN     "defaultAccountId" TEXT;

-- AlterTable
ALTER TABLE "IncomeTransaction" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeAccount" (
    "envelopeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "EnvelopeAccount_pkey" PRIMARY KEY ("envelopeId","accountId")
);

-- CreateIndex
CREATE INDEX "Account_householdId_idx" ON "Account"("householdId");

-- CreateIndex
CREATE INDEX "EnvelopeAccount_accountId_idx" ON "EnvelopeAccount"("accountId");

-- CreateIndex
CREATE INDEX "ExpenseTransaction_accountId_date_idx" ON "ExpenseTransaction"("accountId", "date" DESC);

-- CreateIndex
CREATE INDEX "IncomeTransaction_accountId_date_idx" ON "IncomeTransaction"("accountId", "date" DESC);

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_primaryAccountId_fkey" FOREIGN KEY ("primaryAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTransaction" ADD CONSTRAINT "ExpenseTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTransaction" ADD CONSTRAINT "IncomeTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeAccount" ADD CONSTRAINT "EnvelopeAccount_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeAccount" ADD CONSTRAINT "EnvelopeAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
