-- Optionale Notiz auf Spar-Execution (issue #38).
--
-- Motivation: Mit dem Execution-Booking-UI koennen Members jetzt Ein-
-- und Auszahlungen buchen. Ohne Notiz-Feld ist die spaetere History
-- (issue #39) eine reine Zahlenliste ohne Kontext ("50 € am 15.07. —
-- wofuer?"). Eine kurze Notiz macht die Buchungen nachvollziehbar,
-- ohne den Quick-Capture-Flow zu blockieren (Notiz ist optional).
--
-- Nullable, kein Default — bestehende Buchungen und Quick-Bookings
-- ohne Notiz bleiben zulaessig. Der UI-Dialog sendet `note` nur,
-- wenn der User etwas eingibt, der Server akzeptiert beides.

-- AlterTable
ALTER TABLE "SavingsGoalExecution"
ADD COLUMN "note" TEXT;
