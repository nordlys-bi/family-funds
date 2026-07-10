-- Soft-Delete auf Transaktionen (issue #58).
--
-- Motivation: Aktuell loescht DELETE /expenses/:id und /incomes/:id die
-- Zeile hart. Bei einer Finanz-App ist das ein Vertrauens-Risiko: ein
-- falscher Klick auf das Trash-Icon bei einer 200€-Buchung entfernt die
-- Buchung inkl. Auswirkung auf die Budget-Auslastung ohne Recovery.
--
-- Variante A (soft-permanent): DELETE setzt `deletedAt = now()`, Queries
-- filtern `deletedAt: null`. Audit-Trail bleibt in der DB erhalten, ein
-- expliziter POST /restore setzt den Wert zurueck. Kein Cron / kein
-- Auto-Hard-Delete nach Timeout — DB-Groesse ist im privaten Use-Case
-- irrelevant, Audit-Trail ist wertvoll.
--
-- Nullable, kein Default — bestehende Zeilen bekommen `deletedAt = NULL`
-- und sind damit "aktiv". Beim Restore wird der Wert explizit auf NULL
-- gesetzt.
--
-- Zusaetzlicher Composite-Index `(householdId, deletedAt)`: der
-- ueberwiegende Anteil der Queries laeuft jetzt mit
-- `where: { householdId, deletedAt: null, ... }`. Ohne diesen Index
-- macht Postgres Bitmap-Index-Scan auf `(householdId, date DESC)` und
-- dann Post-Filter auf `deletedAt` — das ist OK, aber bei vielen
-- soft-deleted Rows (z. B. Familien mit Jahren an History) wird der
-- Post-Filter teuer. Der explizite Index macht den Lookup direkt.

-- AlterTable
ALTER TABLE "ExpenseTransaction"
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "IncomeTransaction"
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseTransaction_householdId_deletedAt_idx"
ON "ExpenseTransaction"("householdId", "deletedAt");

CREATE INDEX IF NOT EXISTS "IncomeTransaction_householdId_deletedAt_idx"
ON "IncomeTransaction"("householdId", "deletedAt");
