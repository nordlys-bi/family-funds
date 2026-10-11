# Budget als virtuelles Konto mit fortlaufendem Saldo

Status: accepted

Bisher war ein Budget ein periodischer Maximalbetrag: Am Ende jeder Periode startete es wieder bei 0, Reste und Überziehungen gingen verloren. Das bildet die Realität falsch ab — nicht ausgegebenes Budget ist echtes Geld, das danach in der App nicht mehr auftaucht, und eine Überziehung war real bezahlt, ohne dass sie später irgendwo fehlt.

Ab jetzt ist ein Budget ein **virtuelles Konto**. Der Betrag einer `BudgetVersion` ist keine Obergrenze mehr, sondern eine **Zuteilung**, die zu Beginn jeder Periode auf das Konto gutgeschrieben wird. Ausgaben werden dagegen gebucht. Der **Saldo** bleibt über Periodengrenzen hinweg stehen — positiv wie negativ.

## Saldo-Formel

```
saldo(budget, t) = Σ Zuteilungen aller Perioden mit Start in [balanceSince, min(t, closedAt))
                 − Σ ExpenseTransaction.amount  (budgetId = budget, deletedAt: null, date in [balanceSince, t])
                 − Σ SavingsGoalExecution.amount (sourceBudgetId = budget, date in [balanceSince, t])
                 + Σ saldo(vorgänger)           (für jedes Budget mit carryoverToBudgetId = budget,
                                                 sobald t ≥ Einfließzeitpunkt, siehe "Budget schließen")
```

Der Saldo wird **nicht persistiert**, sondern pro Request aus `BudgetVersion`s und realen Buchungen aggregiert — wie Coverage ([ADR-0002](0002-recurring-plan-coverage.md)) und Forecast ([ADR-0003](0003-forecast-mode.md)). Nachträglich erfasste, geänderte oder gelöschte Buchungen korrigieren den Saldo damit automatisch — auch über geschlossene Vorgänger hinweg.

**Zuteilungen sind keine Buchungen.** Sie werden aus den `BudgetVersion`s abgeleitet, nicht als Zeilen geschrieben (kein Cron-Job, keine Lazy-Erzeugung, kein Drift bei rückwirkend geänderten Versionen). Sie sind insbesondere **keine `IncomeTransaction`** — eine Zuteilung ist eine interne Verteilung, kein Geldeingang, und würde sonst Einnahmen-Reports verfälschen.

## Regeln

**Kein Verfall, keine Obergrenze.** Ein Saldo verfällt nie und ist nicht gedeckelt; er darf auch negativ werden. Ein Verfall würde genau das Problem wiederherstellen, das diese Entscheidung löst: Geld, das real da ist, aber in der App fehlt.

**Frequenz gehört zum Budget, nicht zur Version.** `frequency` wandert von `BudgetVersion` auf `Budget` und ist nach dem Anlegen unveränderlich. Eine andere Periodizität bedeutet ein neues Budget (siehe "Budget schließen"). Damit ist über die `budgetId` jeder Buchung eindeutig, gegen welches Konto mit welchem Periodenraster sie zählt, und es gibt keine Überlappungen oder Lücken durch Frequenzwechsel. Migration: Bestehende Budgets haben durchgängig Versionen mit derselben Frequenz (geprüft); sie wird auf das `Budget` übernommen.

**Zuteilungszeitpunkte.** Jede Periode bekommt beim Periodenbeginn den Betrag der Version, die zu diesem Zeitpunkt gilt. Die Perioden folgen dem bestehenden Raster aus `startOfPeriod`/`addPeriod` (`server/utils/budget-evaluation.ts`): WEEKLY montags, MONTHLY zum 1., QUARTERLY zum Quartalsbeginn, YEARLY zum 1.1., ONCE genau einmal zu `balanceSince`.

**Versionen ändern nur den Betrag, und nur zum Periodenbeginn.** `validFrom` muss ein Periodenbeginn der Budget-Frequenz sein (`assertPeriodStart` in `planning.post.ts`/`planning.patch.ts`); die erste Zuteilung der neuen Version erfolgt zu ihrem `validFrom`. (Sollten Altdaten ein `validFrom` mitten in einer Periode haben, greift die Version ab dem nächsten Periodenbeginn — wie die Wochenregel aus #142.)

**Startpunkt (`Budget.balanceSince`).** Ab diesem Zeitpunkt zählen Zuteilungen und Buchungen in den Saldo; davor liegende Buchungen bleiben für Reports sichtbar, beeinflussen den Saldo aber nicht. Die Periode, die `balanceSince` enthält, bekommt die volle Zuteilung.
- Neue Budgets: `balanceSince = startOfPeriod(validFrom der ersten Version)`.
- Bestehende Budgets (Migration): `balanceSince = startOfPeriod(2026-09-14, frequency)` — also rückwirkend ab dem 14.9.2026 (ein Montag). Monatsbudgets starten damit am 1.9. mit voller Septemberzuteilung und allen Septemberausgaben, damit der erste Saldo in sich stimmig ist statt anteilig gerechnet. Für QUARTERLY/YEARLY-Budgets reicht dieser Startpunkt entsprechend weiter zurück (1.7. bzw. 1.1.).

## Budget schließen

Ein Budget wird zu einem Stichtag geschlossen (`Budget.closedAt`, exklusiv) und gibt seinen Saldo an ein **anderes Budget** weiter (`Budget.carryoverToBudgetId`). Typischer Anlass: Wechsel der Periodizität (z.B. "Lebensmittel" wöchentlich → monatlich) — dafür wird ein neues Budget angelegt und das alte in dieses geschlossen.

- **Ziel ist Pflicht.** Ein geschlossenes Budget hat immer ein Ziel-Budget, auch wenn der Saldo zum Schließzeitpunkt 0 ist — eine spätere Nachbuchung könnte ihn noch verändern, und dieses Geld darf nicht verschwinden. Ziel kann nur ein Budget sein, kein Spartopf (dafür gibt es die manuelle Umbuchung, siehe unten).
- **Übertrag ist ein Verweis, keine Buchung.** Es wird kein Betrag festgeschrieben. Der Saldo des Ziels enthält immer den *aktuellen* Endsaldo des Vorgängers (`saldo(vorgänger, closedAt)` inkl. späterer Korrekturen von Buchungen vor dem Stichtag). Ketten (A → B → C) lösen sich rekursiv auf. Der Endsaldo fließt zum späteren der beiden Zeitpunkte `closedAt` und `balanceSince` des Ziels ein.
- **Stichtag** ist ein Periodenbeginn der Frequenz des geschlossenen Budgets, damit die letzte Periode nicht voll zugeteilt, aber nur teilweise genutzt wird.
- **Nach dem Stichtag:** keine Zuteilungen mehr, keine Versionen mit `validFrom ≥ closedAt`, keine Ausgaben und keine Spartopf-Umbuchungen mit Datum `≥ closedAt` auf dieses Budget (UI filtert die Budget-Auswahl nach Buchungsdatum, Server validiert). Buchungen **vor** dem Stichtag dürfen weiter erfasst und korrigiert werden.
- **Konsistenz:** Ziel im selben Haushalt, nicht das Budget selbst, und zum Stichtag noch offen (`closedAt` null oder später). Damit sind Zyklen ausgeschlossen — ein Budget, das früher geschlossen wurde, kann kein Ziel eines später geschlossenen sein.
- Schließen ist Planung: nur OWNER. Ein Wiederöffnen ist vorerst nicht vorgesehen.

## Löschen

Löschen ist nur noch erlaubt, solange ein Budget **keine Spuren** hat: keine `ExpenseTransaction` (auch keine soft-gelöschte — deren Wiederherstellung würde sonst eine Buchung ohne Budget zurückbringen), keine `SavingsGoalExecution` mit `sourceBudgetId` und kein Vorgänger, der in dieses Budget geschlossen wurde (`carryoverToBudgetId` mit `onDelete: Restrict`). Sonst muss es geschlossen werden. Heute löscht `DELETE .../budgets/:id` ohne Prüfung und setzt `budgetId` an den Ausgaben auf null — damit würde der Saldo samt realem Geld aus der App verschwinden.

## Umbuchung in Spartöpfe

Ein Budgetsaldo (ganz oder teilweise) kann in einen Spartopf umgebucht werden. Dafür bekommt `SavingsGoalExecution` ein optionales `sourceBudgetId` (`onDelete: SetNull`):

- Eine Execution mit `sourceBudgetId` erhöht den Topf um `amount` **und** senkt den Saldo des Quell-Budgets um denselben Betrag.
- Ein negativer `amount` bucht in die Gegenrichtung: Der Topf gibt Geld an das Budget ab (z.B. eine Überziehung aus einem Puffer-Topf ausgleichen).
- Es gibt keine Einschränkung auf den verfügbaren Saldo — umbuchen ins Negative ist erlaubt, das UI warnt höchstens.
- Umbuchen ist eine Buchung, keine Planung: MEMBER dürfen es, wie andere Topf-Bewegungen.

**Bewusst eine Zeile, keine Doppelbuchung.** Anders als in [ADR-0001](0001-expense-as-double-booking.md) fließt hier kein Geld aus dem Haushalt ab — es wird nur zwischen zwei virtuellen Töpfen verschoben und darf nicht in Ausgaben-Reports auftauchen. Eine zweite Zeile hätte keinen Reporting-Zweck und nur das Risiko, auseinanderzulaufen. Ein Budget mit solchen Umbuchungen kann nicht gelöscht, nur geschlossen werden (siehe "Löschen").

## Verhältnis zu bestehenden Konzepten

- **Periodenansicht bleibt.** Monatsübersicht, Wochenzuordnung (#142) und Forecast ([ADR-0003](0003-forecast-mode.md)) arbeiten weiter mit "Zuteilung der Periode vs. Ausgaben der Periode" — das beantwortet "Wie gut liegen wir diesen Monat im Plan?". Der Saldo kommt als zweite Zahl hinzu ("Wie viel ist insgesamt noch da?"). Ob der Forecast zusätzlich auf den Saldo hochrechnet, entscheiden wir separat.
- **Budget vs. SavingsGoal.** Beide haben jetzt einen aus Bewegungen berechneten Saldo. Der Unterschied: Ein Budget wird automatisch periodisch aufgefüllt und ist zum Verbrauchen da; ein Spartopf wird manuell bespart und dient einem Zweck/Ziel.
- **Kein Kontoabgleich.** Ein Abgleich des theoretisch verfügbaren Geldes mit einem realen Kontostand (inkl. Verbuchen von Differenzen) ist bewusst nicht Teil dieser Entscheidung und wird separat entworfen.

## Verworfene Alternativen

- **Persistierte Zuteilungen bzw. Periodenabschluss-Snapshots** — stabile Zahlen, aber Drift bei Nachbuchungen und rückwirkenden Versionsänderungen; bräuchte Job oder Abschluss-Aktion.
- **Konfigurierbarer Übertrag (verfällt / wird übertragen / gedeckelt)** — verworfen, weil jeder Verfall reales Geld aus der App verschwinden lässt. Mit "kein Verfall" gibt es nichts mehr zu konfigurieren.
- **Manueller Übertrag per Buchung** — der Nutzer müsste jeden Periodenwechsel aktiv übernehmen; genau das Vergessens-Risiko, das die App beseitigen soll.
- **Rest automatisch in einen Spartopf** — versteckt den Übertrag außerhalb des Budgets. Bleibt als manuelle Umbuchung möglich, aber nicht als Automatik.
- **Frequenzwechsel per Version** — erzeugt Überlappungen (bereits zugeteilte alte Periode + neue Zuteilungen) und macht unklar, gegen welches Periodenraster eine Buchung zählt. Ersetzt durch "neues Budget + altes schließen".
- **Schließ-Übertrag als festgeschriebene Buchung** — Nachbuchungen vor dem Stichtag hinterließen einen Restsaldo auf dem geschlossenen Budget, der manuell nachgezogen werden müsste. Der Verweis lässt solche Korrekturen automatisch weiterfließen.
- **Schließen in einen Spartopf** — würde die Regel "Topf-Stand = Summe der Executions" um berechnete Zuflüsse erweitern. Nicht nötig, weil Restbeträge per Umbuchung in einen Topf gehen können.
