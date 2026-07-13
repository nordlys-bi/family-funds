-- Budget-Default auf Recurring-Plaenen (issue #59 polish).
--
-- Motivation: Recurring-Transaktionen (z. B. "Miete jeden Monat")
-- sollen beim "Als bezahlt markieren"-Flow automatisch das passende
-- Budget erben. Vorher musste der User pro Monat das Budget-Dropdown
-- bedienen, was bei Planaenen mit schwankendem Betrag (Miete +
-- Nebenkosten) eine aergerliche Pflicht-Auswahl war.
--
-- Wir haengen das Budget an den Plan, nicht an die Transaktion. Wer
-- den Default nicht will, laesst das Feld leer — die Transaktion
-- startet dann ohne Budget (wie bisher ohne Plan-Budget).
--
-- onDelete: SetNull analog zum Rueckwaerts-Pointer bei den
-- Transaktionen: Budget-Loeschen hebt die Verknuepfung auf den
-- Plaenen auf, ohne die Plaene zu loeschen.
--
-- Nullable, kein Default — Bestandsplaene bekommen budgetId=NULL,
-- d. h. bisherige Transaktionen verhalten sich wie vorher
-- (kein automatisches Budget).

-- AlterTable
ALTER TABLE "IncomePlan" ADD COLUMN "budgetId" TEXT;
ALTER TABLE "FixedCostPlan" ADD COLUMN "budgetId" TEXT;

-- AddForeignKey
ALTER TABLE "IncomePlan" ADD CONSTRAINT "IncomePlan_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FixedCostPlan" ADD CONSTRAINT "FixedCostPlan_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
