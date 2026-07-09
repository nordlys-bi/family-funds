-- Composite-Indizes auf (householdId, date DESC) und (budgetId, date DESC)
-- fuer ExpenseTransaction / IncomeTransaction.
--
-- Hintergrund (Backend-Review Finding #5): Dashboard-Hot-Path
-- (`/api/households/:id/dashboard`) und Transaction-Endpoint filtern
-- beide `where: { householdId, date: { gte, lt } }` und sortieren
-- `orderBy: { date: 'desc' }`. Ohne Index macht Postgres Seq-Scan + Sort,
-- Skalierung haengt linear mit Household-Volumen.
--
-- Production-Deployment: fuer eine Live-DB > 1 GB sollte dieser
-- Migration manuell mit `CONCURRENTLY`-Pragma angewendet werden
-- (kein Lock waehrend des B-Tree-Builds). Prisma-migrate-dev fuehrt
-- Statements in einer Transaktion aus — `CONCURRENTLY` ist dort nicht
-- zulaessig. Workflow:
--
--   1. `psql $DATABASE_URL -f prisma/migrations/<this>/migration.sql`
--      (CONCURRENTLY manuell eingefuegt vor jedem CREATE INDEX)
--   2. `npx prisma migrate deploy` markiert die Migration als applied
--
-- Auf Dev-DB (leer oder klein) ist die Standard-Variante ohne
-- CONCURRENTLY ausreichend.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseTransaction_householdId_date_idx"
ON "ExpenseTransaction"("householdId", "date" DESC);

CREATE INDEX IF NOT EXISTS "ExpenseTransaction_budgetId_date_idx"
ON "ExpenseTransaction"("budgetId", "date" DESC);

CREATE INDEX IF NOT EXISTS "IncomeTransaction_householdId_date_idx"
ON "IncomeTransaction"("householdId", "date" DESC);
