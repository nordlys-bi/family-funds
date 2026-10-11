-- Budget als virtuelles Konto (ADR-0004).
--
-- 1. `frequency` wandert von `BudgetVersion` auf `Budget` und ist danach
--    unveraenderlich. Bestehende Budgets haben durchgaengig Versionen mit
--    derselben Frequenz (geprueft); uebernommen wird die der neuesten
--    Version. Budgets ohne Version (sollte es nicht geben) bekommen MONTHLY.
-- 2. `balanceSince`: Startpunkt des Saldos. Bestandsbudgets starten
--    rueckwirkend mit der Periode, die den 14.9.2026 enthaelt
--    (= startOfPeriod in server/utils/budget-evaluation.ts): WEEKLY 14.9.,
--    MONTHLY 1.9., QUARTERLY 1.7., YEARLY 1.1., ONCE 14.9.
--    Die Uhrzeit wird von der neuesten Version uebernommen, damit der Wert
--    dieselbe "Mittags"-Normalisierung hat wie die uebrigen Datumswerte
--    (parseDateInput legt Daten auf 12:00 Serverzeit).
-- 3. `closedAt`/`carryoverToBudgetId`: Schliessen mit Pflicht-Uebertrag.
-- 4. `SavingsGoalExecution.sourceBudgetId`: Umbuchung Budget <-> Spartopf.

-- AlterTable: erst nullable anlegen, befuellen, dann NOT NULL setzen.
ALTER TABLE "Budget" ADD COLUMN "frequency" "Frequency",
ADD COLUMN "balanceSince" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "carryoverToBudgetId" TEXT;

WITH latest AS (
  SELECT DISTINCT ON ("budgetId") "budgetId", "frequency", "validFrom"
  FROM "BudgetVersion"
  ORDER BY "budgetId", "validFrom" DESC
)
UPDATE "Budget" b
SET "frequency" = COALESCE(latest."frequency", 'MONTHLY'::"Frequency"),
    "balanceSince" = (
      CASE COALESCE(latest."frequency", 'MONTHLY'::"Frequency")
        WHEN 'WEEKLY' THEN DATE '2026-09-14'
        WHEN 'MONTHLY' THEN DATE '2026-09-01'
        WHEN 'QUARTERLY' THEN DATE '2026-07-01'
        WHEN 'YEARLY' THEN DATE '2026-01-01'
        WHEN 'ONCE' THEN DATE '2026-09-14'
      END
    ) + COALESCE(latest."validFrom" - date_trunc('day', latest."validFrom"), INTERVAL '10 hours')
FROM "Budget" b2
LEFT JOIN latest ON latest."budgetId" = b2."id"
WHERE b."id" = b2."id";

ALTER TABLE "Budget" ALTER COLUMN "frequency" SET NOT NULL,
ALTER COLUMN "balanceSince" SET NOT NULL;

-- AlterTable
ALTER TABLE "BudgetVersion" DROP COLUMN "frequency";

-- AlterTable
ALTER TABLE "SavingsGoalExecution" ADD COLUMN "sourceBudgetId" TEXT;

-- CreateIndex
CREATE INDEX "SavingsGoalExecution_sourceBudgetId_date_idx" ON "SavingsGoalExecution"("sourceBudgetId", "date");

-- AddForeignKey: NO ACTION statt RESTRICT, siehe Kommentar in schema.prisma
-- (RESTRICT wuerde das Cascade-Loeschen eines Haushalts blockieren).
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_carryoverToBudgetId_fkey" FOREIGN KEY ("carryoverToBudgetId") REFERENCES "Budget"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoalExecution" ADD CONSTRAINT "SavingsGoalExecution_sourceBudgetId_fkey" FOREIGN KEY ("sourceBudgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
