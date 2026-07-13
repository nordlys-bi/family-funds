# Recurring-Plan Coverage-Status mit explizitem FK

Status: accepted

Wir binden `FixedCostPlan` und `IncomePlan` an ihre realen Buchungen über einen expliziten Foreign-Key auf der jeweiligen Transaktion (`ExpenseTransaction.fixedCostPlanId` bzw. `IncomeTransaction.incomePlanId`) und berechnen den monatlichen Status als prozentuale Coverage im aktuellen Anzeige-Scope. Der Status wird **nicht persistiert**, sondern bei jedem Request neu aggregiert — das vermeidet Drift und macht den Code simpel.

**Anzeige-Scope und Period-Buckets**

Die "Coverage" bezieht sich auf den aktuellen Monat. Welche Buckets für einen Plan in diesem Monat zählen, hängt von der `Frequency` ab:

- **MONTHLY**: 1 Bucket pro Monat
- **WEEKLY**: 4–5 Buckets pro Monat, Mo–So, Montag entscheidet Monatszugehörigkeit
- **QUARTERLY**: 0 oder 1 Bucket pro Monat, abhängig von `startDate.getMonth() % 3`
- **YEARLY**: 0 oder 1 Bucket pro Monat, abhängig von `startDate.getMonth()`
- **ONCE**: 0 oder 1 Bucket im Fenster `startDate..endDate`

In Monaten mit 0 fälligen Buckets wird der Plan **ausgeblendet** (kein Status-Tag, keine "Als bezahlt markieren"-Action). Ein Toggle am Listenende ("X Pläne diesen Monat nicht relevant") plus `?showAll=1`-URL-Param deckt den Vollständig-Ansichts-Wunsch ab.

**API-Shape**

`GET /api/households/:id/recurring` liefert pro Plan zusätzlich:

```ts
{
  coverage: { due: number, paid: number, percent: number },
  nextDueDate: string | null  // ISO date, null wenn ONCE verstrichen ist
}
```

Bewusst **kein** `status: 'open' | 'paid' | 'overdue'`-Label. Das Label ist eine Convenience, die das Frontend aus `percent` ableitet (`>= 100 → success`, `> 0 → warning`, `== 0 → danger`). Ein Label im Backend wäre Drift-anfällig und würde Percentage-Information verstecken, die für die Tooltip-Anzeige "3 von 4 Wochen bezahlt" gebraucht wird.

**Considered Options:**

- **a) Heuristik-Matching** statt FK (gleicher Betrag + Monat + Text). Abgelehnt — mehrdeutig bei Plänen mit identischem Betrag, bricht wenn der User abweicht, "Status erinnert sich an Konventionen" ist kein gutes UX-Versprechen.

- **b) FK + Heuristik-Migration für Bestandsbuchungen.** Abgelehnt — Software ist nicht produktiv, Bestandsdaten sind nicht relevant. Spart eine Migrations-Run-Script, das später ohnehin weggeworfen wird.

- **c) Status persistieren** (`RecurringPlanStatus`-Tabelle mit Plan/Monat/State). Abgelehnt — Sync-Komplexität (was, wenn Transaktion soft-deleted wird?), implizite Drift-Quelle, "Status ist abgeleitete Information" ist die Wahrheit.

- **d) FK + Coverage-only API** (gewählt). Eine Quelle für "wie viel wurde bezahlt" (die Transaktionen), eine Quelle für "wie viel ist fällig" (Frequency + startDate), der Status ist eine reine Funktion davon.

- **e) "Nur MONTHLY"-MVP.** Verworfen nach Diskussion — der Anwendungsfall (Rundfunkgebühr im Quartal, GEZ im Jahr) ist real, die Logik generalisiert sauber auf alle Frequenzen, also lohnt sich die etwas breitere Implementierung.

- **f) Non-Due-Perioden mit "nicht relevant"-Marker zeigen** statt ausblenden. Verworfen — visuelles Rauschen, Hauptfrage der Recurring-Page ist "was steht diesen Monat an?".

**Consequences:**

- Schema-Migration: `ExpenseTransaction.fixedCostPlanId String?` + `IncomeTransaction.incomePlanId String?` mit `@relation(onDelete: SetNull)` (Löschen eines Plans hebt die Verknüpfung auf, Buchungen bleiben erhalten — analog zu `Budget`-Verhalten).
- Backend-Aggregation: eine zusätzliche Query pro `/recurring`-Request, die pro Plan zählt `count(transactions where planId = plan.id and date in [monthStart, monthEnd])`. Optimierbar mit `groupBy` wenn die Anzahl Pläne wächst; für Side-Project-Größenordnung nicht nötig.
- Period-Bucket-Logik (WEEKLY mit Mo-So, Quarterly-Anker) lebt in einer kleinen Utility (`server/utils/recurring-periods.ts`) — testbar ohne Prisma, vergleichbar mit `savings-progress.ts` aus issue #56.
- Frontend: neuer Coverage-Tag mit Severity-Mapping, "Als bezahlt markieren"-Button öffnet `FormDialog` mit prefilled Betrag (= Plan-`amount`) und Datum (= heute), Budget-Dropdown. POST-Endpoint für Transaktionen muss `fixedCostPlanId`/`incomePlanId` akzeptieren.
- Status-Reset zwischen Monaten ist implizit: Coverage wird aus aktuellem Monats-Fenster aggregiert, beim Monats-Wechsel ist `due` für die meisten Pläne wieder neu zu berechnen, vorher-bezahlte Buckets fallen raus.
- Soft-Delete (issue #58) funktioniert ohne Sonderlogik: gelöschte Transaktionen zählen nicht mehr in `paid`.
- Non-Due-Pläne sind über `?showAll=1` immer noch erreichbar (z. B. um den Plan selbst zu editieren oder zu löschen), nur nicht in der Default-Ansicht sichtbar.
