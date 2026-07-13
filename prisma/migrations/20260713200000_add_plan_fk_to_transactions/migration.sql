-- Plan-FK auf Transaktionen (issue #59).
--
-- Motivation: Auf /budgeting/recurring fehlt die Plan→Ist-Bruecke.
-- Bisher zeigt die Recurring-Page nur die Plaene (Miete 800 €/Monat),
-- ohne zu wissen, ob der User die Miete diesen Monat schon bezahlt hat.
--
-- Wir fuehren einen expliziten FK von Transaktion → Plan ein. Beim
-- "Als bezahlt markieren"-Flow wird die Transaktion mit dem FK angelegt,
-- der monatliche Coverage-Status ("X von Y bezahlt") wird aus
-- Aggregation ueber diesen FK berechnet.
--
-- Nullable, kein Default — Bestandsbuchungen bekommen `fixedCostPlanId
-- = NULL` und sind damit nicht verknuepft. Da die Software noch nicht
-- produktiv ist (siehe ADR 0002), gibt es keine Bestandsdaten-
-- Migration. Coverage startet fuer alle Plaene bei 0%, der User
-- verknuepft seine Buchungen ueber den Convert-Button.
--
-- onDelete: SetNull — Plan loeschen hebt die Verknuepfung auf, ohne
-- die zugehoerigen Buchungen zu verlieren (analog zum `Budget`-FK
-- auf `ExpenseTransaction`).
--
-- Zusaetzlicher Composite-Index `(planId, date DESC)`: Coverage-
-- Queries ("wie viele Buchungen mit diesem Plan in Monat X?") laufen
-- ohne Index als Full-Table-Scan. Mit dem Index wird die Query zum
-- Index-Scan, skaliert linear mit Household-Volumen.

-- AlterTable
ALTER TABLE "ExpenseTransaction" ADD COLUMN "fixedCostPlanId" TEXT;
ALTER TABLE "IncomeTransaction" ADD COLUMN "incomePlanId" TEXT;

-- CreateIndex
CREATE INDEX "ExpenseTransaction_fixedCostPlanId_date_idx" ON "ExpenseTransaction"("fixedCostPlanId", "date" DESC);
CREATE INDEX "IncomeTransaction_incomePlanId_date_idx" ON "IncomeTransaction"("incomePlanId", "date" DESC);

-- AddForeignKey
ALTER TABLE "ExpenseTransaction" ADD CONSTRAINT "ExpenseTransaction_fixedCostPlanId_fkey" FOREIGN KEY ("fixedCostPlanId") REFERENCES "FixedCostPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncomeTransaction" ADD CONSTRAINT "IncomeTransaction_incomePlanId_fkey" FOREIGN KEY ("incomePlanId") REFERENCES "IncomePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
