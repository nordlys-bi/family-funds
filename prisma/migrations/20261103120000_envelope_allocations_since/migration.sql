-- Untergrenze fuer Zuteilungen (ADR-0005): gesetzt, wenn ein Umschlag ohne
-- Zuteilung eine Regel bekommt. Bestehende Umschlaege bleiben bei NULL.
ALTER TABLE "Envelope" ADD COLUMN "allocationsSince" TIMESTAMP(3);
