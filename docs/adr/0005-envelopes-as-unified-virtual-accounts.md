# Umschläge: Budgets, Sparziele und Fixkosten als ein virtuelles Konto

Status: accepted (noch nicht umgesetzt)

Seit [ADR-0004](0004-budget-as-virtual-account.md) sind Budgets virtuelle Konten mit fortlaufendem Saldo. Sparziele sind es der Sache nach auch — ihr Stand ist die Summe der Bewegungen —, werden aber als eigenes Modell mit eigenen Buchungsregeln geführt. Daraus entstehen Sonderwege, die sich gegenseitig stützen müssen:

- Eine Ausgabe aus einem Spartopf braucht eine **Doppelbuchung** ([ADR-0001](0001-expense-as-double-booking.md)), weil eine Ausgabe nur an einem Budget hängen kann.
- Geld zwischen Budget und Topf bewegt eine `SavingsGoalExecution` mit `sourceBudgetId` — eine Sonderform, die nur in eine Richtung modelliert ist (Budget → Topf, negativ für zurück).
- Ein Budget bewertet sich nach "Ausgaben der Periode vs. Zuteilung" und gilt als überzogen, obwohl sein Saldo positiv ist.
- Einnahmen können keinem Budget gutgeschrieben werden (z.B. ein Verkauf zugunsten des Kinder-Budgets).
- Ein Budget ohne regelmäßige Zuteilung (z.B. ein Konto je Elternteil, das nur durch Gutschriften wächst) ist nicht abbildbar.
- Fixkosten werden nicht reserviert; eine Jahresversicherung reißt bei Fälligkeit ein Loch.

Ab jetzt gibt es **ein** Konzept: den **Umschlag** (Code: `Envelope`). Ein Umschlag ist ein virtuelles Konto mit Saldo, nach der Umschlagmethode: Geld wird auf Umschläge verteilt und aus ihnen ausgegeben. Ob er regelmäßig befüllt wird und ob er ein Sparziel hat, sind optionale Eigenschaften. Eine **Gruppe** legt fest, wie die App ihn darstellt.

Diese Entscheidung ist **Stufe 1**. Reelle Konten (Girokonto, Geldbeutel, Sparkonto) und der Abgleich mit realen Kontoständen folgen als Stufe 2 in einer eigenen ADR; Stufe 1 ist so geschnitten, dass sie ohne Stufe 2 in sich schlüssig ist.

## Begriffe

| Begriff (UI) | Code | Bedeutung | heute |
|---|---|---|---|
| **Umschlag** | `Envelope` | virtuelles Konto mit Saldo | `Budget`, `SavingsGoal` |
| **Gruppe** | `Envelope.group` | Anwendungsfall, steuert Darstellung und Vorgaben | — |
| **Zuteilung** | `EnvelopeTransfer` mit `allocationPeriodStart` | zu jedem Periodenbeginn gebuchte Umbuchung aus "Zu verteilen" | berechnet aus `BudgetVersion` |
| **Vorgemerkt** | berechnet | Zuteilungen, die im laufenden Kalendermonat noch fällig werden | — |
| **Sparziel** | `Envelope.targetAmount` | optionaler Zielbetrag | `SavingsGoal.targetAmount` |
| **Zu verteilen** | `envelopeId = null` | nicht verteiltes Geld, genau einmal pro Haushalt | — |
| **Umbuchung** | `EnvelopeTransfer` | Geld von einem Umschlag in einen anderen | `SavingsGoalExecution` |
| **Konto** | `Account` (Stufe 2) | reeller Ort, an dem Geld liegt | — |

"Konto" ist den reellen Konten vorbehalten. An einer Buchung heißen die beiden Felder im UI "Aus Umschlag" (`envelopeId`, wofür) und ab Stufe 2 "Bezahlt mit" (`accountId`, womit).

## Gruppen

Jeder Umschlag gehört zu genau einer Gruppe. Die Gruppe ist **gespeichert und vom OWNER wählbar**, nicht aus den Eigenschaften abgeleitet — sie drückt aus, wofür der Haushalt den Umschlag nutzt, und steuert, wo und wie er in der App erscheint. Die Gruppen sind fest vorgegeben, weil jede ihr eigenes Verhalten im UI hat.

| Gruppe | `group` | Beispiele | Vorgabe beim Anlegen | Darstellung |
|---|---|---|---|---|
| Laufende Ausgaben | `RUNNING` | Lebensmittel, Tanken, Kinder | feste Zuteilung je Woche/Monat | Saldo, Periodenfortschritt, Prognose |
| Fixkosten | `FIXED` | Wohnen, Streaming, Kfz | Zuteilung aus verknüpften Plänen | Pläne, Fälligkeiten, offen/bezahlt, Saldo |
| Rücklagen | `RESERVE` | Autoreparatur, Kleidung, Weihnachten | feste Zuteilung, kein Ziel | Saldo, Verlauf |
| Sparziele | `SAVINGS` | Urlaub | Zielbetrag | Fortschritt zum Ziel |
| Persönlich | `PERSONAL` | Papa, Mama, Taschengeld | keine Zuteilung | Saldo, Bewegungen |

Die Gruppe **setzt Vorgaben, verbietet aber keine Eigenschaft**: Ein Sparziel darf eine monatliche Zuteilung haben, eine Rücklage später ein Ziel bekommen. Gruppen und Eigenschaften sind damit unabhängig (siehe "Verworfene Alternativen"). Rücklagen und Sparziele sind getrennt, weil sie unterschiedliche Fragen beantworten: Ein Sparziel ist irgendwann erreicht, eine Rücklage ist ein Polster für sichere, aber zeitlich offene Ausgaben — ein Fortschrittsbalken passt nur zum Sparziel.

## Saldo-Formel

```
saldo(umschlag, t) = Σ IncomeTransaction.amount   (envelopeId = umschlag)
                   − Σ ExpenseTransaction.amount  (envelopeId = umschlag)
                   + Σ Umbuchungen hinein − Σ Umbuchungen hinaus   (inkl. Zuteilungen)
                   + Σ saldo(vorgänger)           (Schließen, wie ADR-0004)
                   jeweils ab umschlag.balanceSince, ohne soft-gelöschte Buchungen

saldo(Zu verteilen, t) = household.openingBalance
                   + Σ IncomeTransaction.amount   (envelopeId = null)
                   − Σ ExpenseTransaction.amount  (envelopeId = null)
                   + Σ Umbuchungen hinein − Σ Umbuchungen hinaus   (inkl. Zuteilungen)
                   + Σ saldo(in "Zu verteilen" geschlossene Umschläge)
                   jeweils ab household.ledgerSince

frei(t)  = saldo(Zu verteilen, t) − vorgemerkt(t)
```

Salden werden weiterhin nicht persistiert, sondern pro Request über reale Zeilen summiert. Anders als in ADR-0004 sind **Zuteilungen aber gebuchte Zeilen** (siehe "Zuteilung"); der Saldo ist damit eine reine Summe, ohne Perioden abzulaufen.

**Invariante:** `Σ saldo(alle Umschläge) + saldo(Zu verteilen) = openingBalance + Σ Einnahmen − Σ Ausgaben`. Zuteilungen und Umbuchungen verschieben nur. In Stufe 2 wird die rechte Seite durch die Summe der reellen Kontostände überprüfbar.

## Zuteilung

Ein Umschlag hat eine Frequenz (`frequency`, unveränderlich wie in ADR-0004; Frequenzwechsel = neuer Umschlag + alten schließen) und eine von zwei Zuteilungsregeln — oder keine:

- **Fester Betrag** (`Envelope.allocationAmount`): nur der aktuelle Betrag, keine Versionen.
- **Aus Fixkosten-Plänen**: Mehrere `FixedCostPlan`s verweisen auf denselben Umschlag (`FixedCostPlan.envelopeId`, 1 Umschlag : n Pläne — z.B. "Wohnen" für Miete, Strom, Internet). Die Zuteilung je Periode ist die Summe der zu diesem Zeitpunkt aktiven Pläne (`startDate`/`endDate`), **auf die Frequenz des Umschlags umgelegt**: Eine Jahresversicherung über 600 € trägt zu einem Monatsumschlag 50 € bei, ein Quartalsbeitrag ein Drittel. So ist das Geld bei Fälligkeit da. Ein `ONCE`-Plan wird in der Periode seines Datums voll zugeteilt. Gerundet wird kumulativ (gerundete Summe bis einschließlich dieser Periode − gerundete Summe davor), damit über ein Jahr kein Cent verloren geht.
- **Keine**: Der Umschlag wird nur durch Einnahmen und Umbuchungen gefüllt (Persönlich).

**Zuteilungen werden gebucht, und zwar lazy.** Eine Zuteilung ist eine `EnvelopeTransfer`-Zeile aus "Zu verteilen" in den Umschlag mit `allocationPeriodStart` = Periodenbeginn und Datum = Periodenbeginn. Sie wird angelegt, sobald ihre Periode begonnen hat und jemand einen Saldo des Haushalts abruft — kein Job. Damit liegen vergangene Zuteilungen fest: Eine geänderte Regel (Mieterhöhung, neuer Wochenbetrag) wirkt ab der nächsten noch nicht gebuchten Periode, ohne Versionen und ohne rückwirkenden Effekt. Einzelne Zuteilungen lassen sich bearbeiten ("diesen Monat nur 200 €"), und der Verlauf eines Umschlags ist seine Buchungsliste.

Damit das Ergebnis nicht vom Zeitpunkt des Abrufs abhängt, gelten vier Regeln:

1. **Erst nachbuchen, dann ändern.** Jede Änderung an Zuteilungsregel, Plan, Frequenz oder Schließung bucht zuerst alle fälligen Zuteilungen bis heute nach. Sonst bekäme eine schon begonnene, aber noch nicht gebuchte Periode den neuen Betrag.
2. **Ein Einstieg.** Jeder Saldo-Abruf ruft zuerst `ensureAllocations(householdId, today)`. Der Unique-Index `(toEnvelopeId, allocationPeriodStart)` verhindert Dubletten bei parallelen Requests (`createMany` mit `skipDuplicates`); gewöhnliche Umbuchungen haben `allocationPeriodStart = null` und sind nicht betroffen.
3. **Auslassen heißt Betrag 0, nicht löschen.** Eine gelöschte Zuteilung würde beim nächsten Abruf neu angelegt; die Zeile bleibt als Merker.
4. **Keine vorgemerkten Regeländerungen.** "Ab Januar 350 €" wird am 1. Januar geändert. Ein Feld für eine geplante Änderung kommt erst, wenn es gebraucht wird.

Bleibt die App länger ungeöffnet, entstehen beim nächsten Abruf mehrere Zuteilungen auf einmal; wegen Regel 1 hat sich die Regel dazwischen nicht geändert, das Ergebnis ist also eindeutig. Rückwirkende Korrekturen erfolgen durch Bearbeiten der betroffenen Zuteilungen.

## Vorgemerkt

Das Gehalt kommt monatlich, ein Wochen-Umschlag bekommt seine Zuteilung aber erst zu jedem Wochenbeginn. Ohne Vormerkung stünde das Geld für die restlichen Wochen des Monats in "Zu verteilen" als frei da und könnte anderweitig verteilt werden. Geld hat deshalb drei Zustände:

- **Verfügbar** — im Umschlag, gebuchte Zuteilungen.
- **Vorgemerkt** — Zuteilungen, die laut Regel nach heute und bis zum **Ende des Kalendermonats** fällig werden. Berechnet, nicht gebucht; mit der Buchung zum Periodenbeginn wandert der Betrag von vorgemerkt nach verfügbar.
- **Frei** — `saldo(Zu verteilen) − vorgemerkt`.

"Zu verteilen" zeigt als Hauptzahl das freie Geld und darunter die Vormerkungen; eine Umbuchung aus "Zu verteilen" über das freie Geld hinaus wird gewarnt. Ein Umschlag zeigt als Saldo nur das Verfügbare, die Vormerkung als Zusatz ("+900 € kommen bis Monatsende"). Monatliche Umschläge sind am 1. vollständig gebucht und haben im laufenden Monat keine Vormerkung; relevant ist das nur für Frequenzen kürzer als ein Monat. Eine Wochenzuteilung gehört zum Monat ihres Montags.

Der Horizont ist bewusst der Kalendermonat. Ein Haushalts-Stichtag ("unser Monat beginnt am 25.") würde zum Geldfluss passen, wenn das Gehalt mitten im Monat kommt, verschiebt aber konsequenterweise auch die Zuteilungstermine monatlicher Umschläge — das wird bei Bedarf separat entschieden.

## Regeln

**Ausgaben und Einnahmen hängen optional an einem Umschlag** (`envelopeId`, ersetzt `ExpenseTransaction.budgetId`; neu an `IncomeTransaction`). Ohne Umschlag treffen sie "Zu verteilen". Eine Einnahme mit Umschlag ist eine Gutschrift auf diesen Umschlag (Verkauf → Kinder) und bleibt eine Einnahme in allen Reports.

**Ausgaben aus Sparzielen sind normale Ausgaben.** Der Urlaub wird mit `envelopeId = Urlaub` gebucht; eine zweite Zeile entfällt. [ADR-0001](0001-expense-as-double-booking.md) ist damit abgelöst.

**Fixkosten werden als Ausgaben gebucht**, sobald sie vom Konto abgehen — direkt aus dem Plan ("als bezahlt markieren" erzeugt die Ausgabe mit `fixedCostPlanId` und `envelopeId` des Plans). Coverage ([ADR-0002](0002-recurring-plan-coverage.md)) bleibt unverändert.

**Umbuchung** ist eine eigene Zeile `EnvelopeTransfer` (`fromEnvelopeId`, `toEnvelopeId`, `amount > 0`, `date`, `note`, `userId`). `null` auf einer Seite heißt "Zu verteilen". Umbuchungen tauchen in keinem Einnahmen-/Ausgaben-Report auf. Kein Limit auf den verfügbaren Saldo; das UI warnt höchstens. Umbuchen ist eine Buchung: MEMBER dürfen es.

**Bewertung nach Saldo.** Ein Umschlag gilt als überzogen, wenn sein Saldo negativ ist — nicht, wenn die Ausgaben einer Periode die Zuteilung übersteigen. Für Umschläge mit Zuteilung:
- *Verfügbar in der Periode* = Saldo zu Periodenbeginn + Zuteilung der Periode. Der Fortschrittsbalken zeigt Ausgaben ÷ Verfügbar; die Lücke bis zum Ende ist der aktuelle Saldo.
- *rot*: Saldo < 0. *gelb*: Prognose für das Periodenende < 0. *sonst* grün.
- "Ausgaben vs. Zuteilung dieser Periode" bleibt als Information sichtbar, aber nicht als Bewertung.
- Der Forecast ([ADR-0003](0003-forecast-mode.md)) rechnet auf den Saldo am Periodenende hoch statt auf die Periodenausgaben.

Umschläge mit Sparziel zeigen zusätzlich den Fortschritt `saldo ÷ targetAmount`.

**Schließen** wie in ADR-0004, mit einer Erweiterung: Ziel des Übertrags kann ein anderer Umschlag **oder "Zu verteilen"** sein. Damit lässt sich auch ein erreichtes oder aufgegebenes Sparziel sauber auflösen.

**Löschen** wie in ADR-0004: nur ohne Spuren (keine Buchungen, auch soft-gelöschte, keine Umbuchungen, kein Vorgänger), sonst schließen.

**Startpunkt "Zu verteilen".** `Household.ledgerSince` legt fest, ab wann Einnahmen und Ausgaben in "Zu verteilen" zählen; `Household.openingBalance` ist der Bestand zu diesem Zeitpunkt (Default 0). Ohne Startpunkt würden alle historischen Einnahmen und Ausgaben vor Einführung der Umschläge eine Zahl ohne Bedeutung erzeugen. Aussagekräftig ist "Zu verteilen" nur, wenn Einnahmen und Ausgaben — inklusive Fixkosten — vollständig erfasst werden.

**Einnahmen-Pläne** verweisen optional auf einen Umschlag (`IncomePlan.envelopeId`, ersetzt `budgetId`). Eine als erhalten markierte Einnahme aus einem Plan mit Umschlag wird diesem gutgeschrieben (z.B. Kindergeld → Kinder), sonst "Zu verteilen".

**Rechte** unverändert: Umschläge, Zuteilungsregeln, Pläne und Sparziele anlegen, ändern, schließen ist Planung (OWNER), ebenso das Bearbeiten gebuchter Zuteilungen; Buchungen und gewöhnliche Umbuchungen dürfen alle Mitglieder.

## Oberfläche (Leitlinien)

Das genaue Wording ist offen; die Struktur folgt den Gruppen:

- Ein Navigationspunkt für Umschläge, darin eine Ansicht je Gruppe mit der Darstellung aus der Gruppen-Tabelle.
- Die Fixkosten-Ansicht übernimmt die Ausgaben-Seite von "Wiederkehrend": Pläne anlegen und bearbeiten, Fälligkeiten, "als bezahlt markieren" (erzeugt die Ausgabe) und den Umschlag-Saldo an einem Ort. Einnahmen-Pläne bekommen einen eigenen Platz (naheliegend: bei "Zu verteilen").
- Dashboard: "Zu verteilen" als eigene Kachel; "ohne Budgetzuordnung" entfällt zugunsten dieser Kachel.

## Migration

- `Budget` → Umschlag, Gruppe `RUNNING`; `allocationAmount` = Betrag der aktuell gültigen `BudgetVersion`. Die bisher berechneten Zuteilungen werden einmalig als `EnvelopeTransfer`-Zeilen gebucht, danach entfällt `BudgetVersion`. **IDs bleiben erhalten**, damit Links und Verweise (`carryoverToBudgetId`, Pläne, Ausgaben) gültig bleiben.
- `SavingsGoal` → Umschlag, Gruppe `SAVINGS`, mit `targetAmount`; die SavingsGoal-ID wird zur Umschlag-ID. `monthlyRate` wird **nicht** automatisch zur Zuteilung, sonst entstünden rückwirkend Zuteilungen; der OWNER entscheidet pro Sparziel.
- `SavingsGoalExecution` mit `sourceBudgetId` → `EnvelopeTransfer` zwischen den beiden Umschlägen (Vorzeichen bestimmt die Richtung).
- `SavingsGoalExecution` ohne Quelle, positiv → `EnvelopeTransfer` aus "Zu verteilen".
- `SavingsGoalExecution` ohne Quelle, negativ (Doppelbuchung nach ADR-0001): Gibt es **genau eine** umschlaglose Ausgabe mit gleichem Betrag am selben Tag, bekommt sie `envelopeId` = Sparziel und die Execution entfällt. Sonst → `EnvelopeTransfer` in "Zu verteilen". Beide Wege ergeben dieselben Salden; der erste ist nur sauberer.
- `FixedCostPlan.budgetId` → `envelopeId` unverändert übernommen. Fixkosten-Umschläge legt der OWNER nach der Migration an und ordnet die Pläne zu.
- `ledgerSince` = Migrationsdatum, `openingBalance` = 0. Der OWNER kann beides danach setzen.

## Verworfene Alternativen

- **Budget und Sparziel getrennt lassen, nur Lücken stopfen** (`budgetId` an Einnahmen, Budget ohne Versionen). Löst die Punkte einzeln, behält aber zwei Modelle mit fast gleicher Semantik, die Doppelbuchung und die einseitige Umbuchung.
- **Ein Typ-Feld, das Eigenschaften festlegt** (BUDGET | SAVINGS | ACCOUNT). Jede Kombination (Sparziel mit Zuteilung, Rücklage mit Ziel) bräuchte einen eigenen Typ. Die Gruppe übernimmt die Darstellung, ohne Eigenschaften zu verbieten.
- **Gruppe aus Eigenschaften ableiten.** Nicht eindeutig (gehört ein Sparziel mit Zuteilung zu Sparen oder Laufend?) und nimmt dem Haushalt die Entscheidung, wofür er einen Umschlag nutzt.
- **Frei anlegbare Gruppen.** Jede Gruppe hat eigenes Verhalten im UI; freie Gruppen hätten keins. Eigene Ordnungen (alles rund um die Kinder) können später als Markierungen dazukommen.
- **"Konto" für Umschläge, mit Kontoarten.** Ab Stufe 2 trifft jede Ausgabe ein reelles und ein virtuelles Konto — zwei Felder "Konto" in einer Maske; "Papas Konto" meint im Alltag sein Girokonto; "Sparkonto" ist ein Bankprodukt. Keine verbreitete Haushalts-App nennt zweckgebundenes Geld "Konto" (Actual/YNAB: Category, Banktivity: Envelope, Firefly: Piggy Bank).
- **Andere Begriffe** — Topf (zu salopp, stark aufs Sparen festgelegt), Kasse (klingt nach Bargeld), Fach, Rücklage, Fonds, Posten, Kategorie, Pocket/Unterkonto (bei deutschen Banken echte IBAN-Konten).
- **Fixkosten direkt aus "Zu verteilen".** Einfacher, aber "Zu verteilen" schwankt mit jeder Fälligkeit, und jährliche Kosten werden nicht angespart.
- **Zuteilungen weiter berechnen (ADR-0004).** Dann wirkt jede Regeländerung rückwirkend; dagegen hilft nur Versionierung — für feste Beträge (`BudgetVersion`) und zusätzlich für jeden Fixkosten-Plan. Gebuchte Zuteilungen sparen beides, und das Drift-Argument aus ADR-0004 entfällt, weil es ohne Versionen nichts gibt, wovon die Zeilen abweichen könnten.
- **Zuteilungen per Job.** Lazy beim Abruf reicht, weil Zuteilungen nur beim Lesen eines Saldos gebraucht werden.
- **Alle Zuteilungen des Monats am 1. mit künftigem Datum buchen** (statt Vormerkung zu berechnen). Erlaubt, eine Woche im Voraus auszulassen, aber jede Regeländerung müsste künftige Zeilen umschreiben, ohne von Hand geänderte zu überschreiben.
- **Gutschrift als negative Ausgabe.** Passt für Erstattungen, aber ein Verkauf ist keine geminderte Ausgabe und gehört in die Einnahmen.
- **Kein "Zu verteilen" in Stufe 1.** Einfacher, aber ohne ihn gibt es keinen Ort für umschlaglose Einnahmen und kein Ziel beim Auflösen eines Umschlags; die Invariante wäre erst in Stufe 2 formulierbar.

## Folgen

- Löst [ADR-0001](0001-expense-as-double-booking.md) ab, erweitert [ADR-0004](0004-budget-as-virtual-account.md) (Saldo-Konzept, Schließen, Löschen bleiben gültig; "Zuteilungen sind keine Buchungen" und `BudgetVersion` werden durch gebuchte Zuteilungen ersetzt, "Periodenansicht bleibt" durch "Bewertung nach Saldo"), ändert die Hochrechnung aus [ADR-0003](0003-forecast-mode.md). [ADR-0002](0002-recurring-plan-coverage.md) bleibt gültig; Pläne bekommen zusätzlich eine Rolle als Zuteilungsquelle.
- `CONTEXT.md` (Budget, SavingsGoal, Buchungs-Logik, Doppelbuchung, Umbuchung) beschreibt bis zur Umsetzung weiter den Ist-Stand und verweist auf diese ADR; umgeschrieben wird mit der Umsetzung.
- API: `/budgets` und `/savings-goals` werden zu `/envelopes`; Gruppen-Ansichten filtern per `group`.
