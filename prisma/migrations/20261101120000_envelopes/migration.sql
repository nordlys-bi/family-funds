-- Umschlaege (ADR-0005, issue #155).
--
-- Budget und SavingsGoal werden zu Envelope (IDs bleiben erhalten), Zuteilungen
-- und Topf-Bewegungen zu EnvelopeTransfer. Die alten Tabellen und Spalten
-- bleiben als Altbestand stehen und werden nicht mehr beschrieben; geloescht
-- werden sie in #160 bzw. nach dem Umstieg (#164).
--
-- Ablauf:
--   1. Struktur anlegen (von `prisma migrate diff` erzeugt).
--   2. Budgets → Umschlaege der Gruppe RUNNING, Sparziele → SAVINGS.
--   3. budgetId → envelopeId an Ausgaben und Plaenen.
--   4. Bisher berechnete Zuteilungen (ADR-0004) als Zeilen buchen — in SQL,
--      nicht per Script, damit nach dem Deploy kein Request mit
--      `ensureAllocations` die Vergangenheit mit dem aktuellen Betrag bucht,
--      bevor ein Backfill gelaufen ist.
--   5. SavingsGoalExecutions → Umbuchungen; ADR-0001-Doppelbuchungen werden,
--      wo eindeutig, zu einer Ausgabe aus dem Sparziel.
--   6. "Zu verteilen" startet am Folgetag (ledgerSince), damit die heute
--      migrierten Zuteilungen nicht in ihn zaehlen.
--
-- Uhrzeit: Datumswerte liegen auf "Mittag" (parseDateInput, 12:00
-- Serverzeit). Gebuchte Perioden uebernehmen die Uhrzeit von balanceSince,
-- wie die Migration 20261011180000_budget_virtual_account.


-- CreateEnum
CREATE TYPE "EnvelopeGroup" AS ENUM ('RUNNING', 'FIXED', 'RESERVE', 'SAVINGS', 'PERSONAL');

-- CreateEnum
CREATE TYPE "AllocationSource" AS ENUM ('NONE', 'FIXED', 'PLANS');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "ledgerSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "openingBalance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "IncomePlan" ADD COLUMN     "envelopeId" TEXT;

-- AlterTable
ALTER TABLE "FixedCostPlan" ADD COLUMN     "envelopeId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseTransaction" ADD COLUMN     "envelopeId" TEXT;

-- AlterTable
ALTER TABLE "IncomeTransaction" ADD COLUMN     "envelopeId" TEXT;

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "EnvelopeGroup" NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "allocationSource" "AllocationSource" NOT NULL DEFAULT 'NONE',
    "allocationAmount" INTEGER,
    "targetAmount" INTEGER,
    "targetDate" TIMESTAMP(3),
    "balanceSince" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "carryoverToEnvelopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeTransfer" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fromEnvelopeId" TEXT,
    "toEnvelopeId" TEXT,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "allocationPeriodStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvelopeTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Envelope_householdId_idx" ON "Envelope"("householdId");

-- CreateIndex
CREATE INDEX "EnvelopeTransfer_householdId_date_idx" ON "EnvelopeTransfer"("householdId", "date");

-- CreateIndex
CREATE INDEX "EnvelopeTransfer_fromEnvelopeId_date_idx" ON "EnvelopeTransfer"("fromEnvelopeId", "date");

-- CreateIndex
CREATE INDEX "EnvelopeTransfer_toEnvelopeId_date_idx" ON "EnvelopeTransfer"("toEnvelopeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeTransfer_toEnvelopeId_allocationPeriodStart_key" ON "EnvelopeTransfer"("toEnvelopeId", "allocationPeriodStart");

-- CreateIndex
CREATE INDEX "ExpenseTransaction_envelopeId_date_idx" ON "ExpenseTransaction"("envelopeId", "date" DESC);

-- CreateIndex
CREATE INDEX "IncomeTransaction_envelopeId_date_idx" ON "IncomeTransaction"("envelopeId", "date" DESC);

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_carryoverToEnvelopeId_fkey" FOREIGN KEY ("carryoverToEnvelopeId") REFERENCES "Envelope"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_fromEnvelopeId_fkey" FOREIGN KEY ("fromEnvelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_toEnvelopeId_fkey" FOREIGN KEY ("toEnvelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomePlan" ADD CONSTRAINT "IncomePlan_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCostPlan" ADD CONSTRAINT "FixedCostPlan_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTransaction" ADD CONSTRAINT "ExpenseTransaction_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTransaction" ADD CONSTRAINT "IncomeTransaction_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invarianten, die Prisma nicht ausdruecken kann.
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_side_check"
  CHECK ("fromEnvelopeId" IS NOT NULL OR "toEnvelopeId" IS NOT NULL);
ALTER TABLE "EnvelopeTransfer" ADD CONSTRAINT "EnvelopeTransfer_distinct_check"
  CHECK ("fromEnvelopeId" IS DISTINCT FROM "toEnvelopeId");

-- 2a. Budgets → RUNNING. Zuteilungsbetrag = die heute gueltige Version
-- (sonst die frueheste), wie findAllocatingVersion in budget-balance.ts.
INSERT INTO "Envelope" (
  "id", "householdId", "name", "group", "frequency", "allocationSource", "allocationAmount",
  "balanceSince", "closedAt", "createdAt", "updatedAt"
)
SELECT
  b."id", b."householdId", b."name", 'RUNNING', b."frequency", 'FIXED',
  COALESCE(
    (SELECT v."amount" FROM "BudgetVersion" v
      WHERE v."budgetId" = b."id" AND v."validFrom"::date <= CURRENT_DATE
      ORDER BY v."validFrom" DESC LIMIT 1),
    (SELECT v."amount" FROM "BudgetVersion" v
      WHERE v."budgetId" = b."id"
      ORDER BY v."validFrom" ASC LIMIT 1),
    0
  ),
  b."balanceSince", b."closedAt", b."createdAt", b."updatedAt"
FROM "Budget" b;

-- Erst nach dem Insert, weil das Ziel ein spaeter eingefuegtes Budget sein kann.
UPDATE "Envelope" e
SET "carryoverToEnvelopeId" = b."carryoverToBudgetId"
FROM "Budget" b
WHERE b."id" = e."id" AND b."carryoverToBudgetId" IS NOT NULL;

-- 2b. Sparziele → SAVINGS, ohne Zuteilung: monthlyRate war eine Planzahl;
-- daraus rueckwirkend Zuteilungen zu machen, wuerde Salden veraendern. Der
-- Saldo zaehlt ab der fruehesten Bewegung, damit alle Executions drin sind.
INSERT INTO "Envelope" (
  "id", "householdId", "name", "group", "frequency", "allocationSource",
  "targetAmount", "targetDate", "balanceSince", "createdAt", "updatedAt"
)
SELECT
  g."id", g."householdId", g."name", 'SAVINGS', 'MONTHLY', 'NONE',
  g."targetAmount", g."endDate",
  LEAST(g."startDate", COALESCE((SELECT MIN(x."date") FROM "SavingsGoalExecution" x WHERE x."savingsGoalId" = g."id"), g."startDate")),
  g."createdAt", g."updatedAt"
FROM "SavingsGoal" g;

-- 3. Verweise uebernehmen.
UPDATE "ExpenseTransaction" SET "envelopeId" = "budgetId" WHERE "budgetId" IS NOT NULL;
UPDATE "FixedCostPlan" SET "envelopeId" = "budgetId" WHERE "budgetId" IS NOT NULL;
UPDATE "IncomePlan" SET "envelopeId" = "budgetId" WHERE "budgetId" IS NOT NULL;

-- 4. Zuteilungen der Perioden mit Start in [balanceSince, min(heute, closedAt)).
-- Raster wie startOfPeriod/addPeriod (Wochen ab Montag), Betrag wie
-- findAllocatingVersion: die zum Periodenbeginn gueltige Version, sonst die
-- erste, die in der Periode beginnt, sonst 0 (als ausgelassene Periode).
WITH periods AS (
  SELECT b."id" AS "budgetId", b."householdId", b."closedAt",
         p."start"::date AS "day",
         (p."start" + step."interval")::date AS "nextDay",
         b."balanceSince" - date_trunc('day', b."balanceSince") AS "timeOfDay"
  FROM "Budget" b
  CROSS JOIN LATERAL (
    SELECT CASE b."frequency"
      WHEN 'WEEKLY' THEN INTERVAL '1 week'
      WHEN 'MONTHLY' THEN INTERVAL '1 month'
      WHEN 'QUARTERLY' THEN INTERVAL '3 months'
      WHEN 'YEARLY' THEN INTERVAL '1 year'
      ELSE NULL
    END AS "interval",
    CASE b."frequency"
      WHEN 'WEEKLY' THEN 'week'
      WHEN 'MONTHLY' THEN 'month'
      WHEN 'QUARTERLY' THEN 'quarter'
      WHEN 'YEARLY' THEN 'year'
      ELSE 'day'
    END AS "unit"
  ) step
  CROSS JOIN LATERAL (
    SELECT generate_series(
      date_trunc(step."unit", b."balanceSince"),
      -- ONCE: genau eine Periode zu balanceSince.
      CASE WHEN step."interval" IS NULL THEN date_trunc('day', b."balanceSince") ELSE CURRENT_DATE::timestamp END,
      COALESCE(step."interval", INTERVAL '1 day')
    ) AS "start"
  ) p
  WHERE p."start"::date <= CURRENT_DATE
    AND (b."closedAt" IS NULL OR p."start"::date < b."closedAt"::date)
)
INSERT INTO "EnvelopeTransfer" (
  "id", "householdId", "fromEnvelopeId", "toEnvelopeId", "amount", "date",
  "allocationPeriodStart", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, p."householdId", NULL, p."budgetId",
  COALESCE(
    (SELECT v."amount" FROM "BudgetVersion" v
      WHERE v."budgetId" = p."budgetId" AND v."validFrom"::date <= p."day"
      ORDER BY v."validFrom" DESC LIMIT 1),
    (SELECT v."amount" FROM "BudgetVersion" v
      WHERE v."budgetId" = p."budgetId" AND v."validFrom"::date >= p."day"
        AND (p."nextDay" IS NULL OR v."validFrom"::date < p."nextDay")
      ORDER BY v."validFrom" ASC LIMIT 1),
    0
  ),
  p."day" + p."timeOfDay", p."day" + p."timeOfDay", now(), now()
FROM periods p;

-- 5a. Umbuchungen Budget ↔ Spartopf: Vorzeichen bestimmt die Richtung.
INSERT INTO "EnvelopeTransfer" ("id", "householdId", "fromEnvelopeId", "toEnvelopeId", "amount", "date", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, g."householdId",
       CASE WHEN x."amount" > 0 THEN x."sourceBudgetId" ELSE x."savingsGoalId" END,
       CASE WHEN x."amount" > 0 THEN x."savingsGoalId" ELSE x."sourceBudgetId" END,
       ABS(x."amount"), x."date", x."note", x."createdAt", x."updatedAt"
FROM "SavingsGoalExecution" x
JOIN "SavingsGoal" g ON g."id" = x."savingsGoalId"
WHERE x."sourceBudgetId" IS NOT NULL AND x."amount" <> 0;

-- 5b. Ansparungen ohne Quelle kommen aus "Zu verteilen".
INSERT INTO "EnvelopeTransfer" ("id", "householdId", "fromEnvelopeId", "toEnvelopeId", "amount", "date", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, g."householdId", NULL, x."savingsGoalId",
       x."amount", x."date", x."note", x."createdAt", x."updatedAt"
FROM "SavingsGoalExecution" x
JOIN "SavingsGoal" g ON g."id" = x."savingsGoalId"
WHERE x."sourceBudgetId" IS NULL AND x."amount" > 0;

-- 5c. Entnahmen ohne Quelle sind ADR-0001-Doppelbuchungen. Passen sie
-- eindeutig (in beide Richtungen) zu einer umschlaglosen Ausgabe mit
-- gleichem Betrag am selben Tag, wird die Ausgabe dem Sparziel zugeordnet
-- und die Entnahme entfaellt. Sonst wird sie zur Umbuchung nach "Zu
-- verteilen" — beide Wege ergeben dieselben Salden.
-- Kein ON COMMIT DROP: prisma migrate fuehrt das Script nicht in einer
-- expliziten Transaktion aus, die Tabelle waere sofort wieder weg.
CREATE TEMP TABLE "_withdrawal_match" AS
WITH candidates AS (
  SELECT x."id" AS "executionId", x."savingsGoalId", e."id" AS "expenseId"
  FROM "SavingsGoalExecution" x
  JOIN "SavingsGoal" g ON g."id" = x."savingsGoalId"
  JOIN "ExpenseTransaction" e
    ON e."householdId" = g."householdId"
   AND e."envelopeId" IS NULL
   AND e."deletedAt" IS NULL
   AND e."amount" = -x."amount"
   AND e."date"::date = x."date"::date
  WHERE x."sourceBudgetId" IS NULL AND x."amount" < 0
)
SELECT c.*
FROM candidates c
WHERE (SELECT COUNT(*) FROM candidates c2 WHERE c2."executionId" = c."executionId") = 1
  AND (SELECT COUNT(*) FROM candidates c3 WHERE c3."expenseId" = c."expenseId") = 1;

UPDATE "ExpenseTransaction" e
SET "envelopeId" = m."savingsGoalId"
FROM "_withdrawal_match" m
WHERE e."id" = m."expenseId";

INSERT INTO "EnvelopeTransfer" ("id", "householdId", "fromEnvelopeId", "toEnvelopeId", "amount", "date", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, g."householdId", x."savingsGoalId", NULL,
       -x."amount", x."date", x."note", x."createdAt", x."updatedAt"
FROM "SavingsGoalExecution" x
JOIN "SavingsGoal" g ON g."id" = x."savingsGoalId"
WHERE x."sourceBudgetId" IS NULL AND x."amount" < 0
  AND x."id" NOT IN (SELECT "executionId" FROM "_withdrawal_match");

DROP TABLE "_withdrawal_match";

-- 6. "Zu verteilen" startet morgen (Mittag), Anfangsbestand 0. Beides wird
-- beim Umstieg (#164) pro Haushalt festgelegt.
UPDATE "Household"
SET "ledgerSince" = (CURRENT_DATE + 1) + INTERVAL '10 hours';
