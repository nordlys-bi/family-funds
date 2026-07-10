-- Onboarding-Tour-State pro User (issue #16).
--
-- Zwei neue Felder auf der User-Tabelle:
--  - onboardingCompletedSteps: String[]  -- welche Steps hat der User abgeschlossen
--  - onboardingSkipped:        Boolean   -- User hat explizit "Setup später" gewählt
--
-- Per-User (nicht per-Household), weil ein User mehrere Haushalte haben
-- kann und der Onboarding-Flow sich auf den User bezieht, nicht auf den
-- Household-Kontext.
--
-- Default-Werte (leeres Array + false) sorgen dafür, dass alle bestehenden
-- User den Auto-Trigger bekommen — neue User kriegen die Tour, bestehende
-- (mit bereits gefüllten Haushalten) triggern sie nicht (Logik im Frontend:
-- `shouldAutoTrigger()` prüft Household-Lebhaftigkeit, nicht nur die Flags).

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "onboardingCompletedSteps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "onboardingSkipped"        BOOLEAN NOT NULL DEFAULT false;