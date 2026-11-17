# Konten: wo das Geld tatsächlich liegt

Status: accepted (umgesetzt in #188–#192)

Stufe 2 des Geldmodells, erweitert [ADR-0005](0005-envelopes-as-unified-virtual-accounts.md). Umschläge sagen, **wofür** Geld da ist; ein **Konto** (`Account`) ist der reelle Ort, an dem es liegt (Girokonto, Geldbeutel, Sparkonto, Sparschwein). Mit Konten wird die Rechnung aus Stufe 1 prüfbar:

```
Σ Umschläge + Zu verteilen = Σ Konten
```

## Begriffe

| Begriff (UI) | Code | Bedeutung |
|---|---|---|
| **Konto** | `Account` | reeller Ort, an dem Geld liegt |
| **Kontoart** | `AccountType` | Giro, Bargeld, Spar — echter Typ, darf Verhalten steuern |
| **Bezahlt mit** | `accountId` | Konto einer Buchung (womit) |
| **Aus Umschlag** | `envelopeId` | Umschlag einer Buchung (wofür) |
| **Anfangsbestand** | `Account.openingBalance` | Kontostand am Startdatum des Kontos |

## Buchungen nennen immer ein Konto

Jede Ausgabe und Einnahme ab `ledgerSince` nennt ein Konto; das Feld ist Pflicht. Davor bleibt es leer (siehe Migration). Umschläge lassen sich optional an mehrere Konten binden, eines davon ist das Hauptkonto und bei der Erfassung vorausgewählt; die Auswahl ist auf die gebundenen Konten gefiltert. Die Bindung ist nur ein Eingabefilter, keine Buchhaltungsregel: Die Invariante gilt global, nicht je Umschlag. Ein Umschlag ohne Bindung bietet alle Konten an, vorausgewählt ist das Standardkonto des Mitglieds.

Ein Konto außerhalb der Bindung bleibt wählbar: Unter den gebundenen Konten steht **"Anderes Konto…"**, darüber sind alle übrigen Konten des Haushalts erreichbar (Bargeld auf dem Wochenmarkt für einen ans Girokonto gebundenen Umschlag). Eine solche Buchung ist nie falsch, nur ungewöhnlich; eine harte Sperre würde die Bindung zur Regel machen, die sie bewusst nicht ist.

## Anfangsbestände

Jedes Konto hat einen **Anfangsbestand** zu seinem **Startdatum**. Eingegeben werden nur echte Kontostände; der Startwert von "Zu verteilen" wird daraus **abgeleitet** und nicht mehr eingegeben:

```
Zu verteilen (ledgerSince) = Σ Anfangsbestände der Konten ab ledgerSince − Σ Umschläge zum Stichtag
```

Ein Konto, das später dazukommt (das Sparschwein im Februar), schreibt seinen Anfangsbestand an seinem Startdatum "Zu verteilen" gut: Es ist Geld, von dem der Haushalt bisher nichts wusste. Damit stimmt die Invariante am Stichtag und bei jedem neuen Konto per Konstruktion; jede spätere Abweichung bedeutet eine fehlende oder falsche Buchung.

Ist zum Stichtag mehr verteilt, als auf den Konten liegt, startet "Zu verteilen" negativ. Das ist gewollt: Es zeigt den tatsächlichen Stand.

`Household.openingBalance` aus Stufe 1 entfällt als Eingabe.

## Überträge zwischen Konten

Ein **Kontoübertrag** (`AccountTransfer`) bewegt Geld von einem Konto auf ein anderes (Geld abheben, Sparrate aufs Tagesgeld) und berührt **keinen Umschlag**: Das Geld behält seinen Zweck, nur der Ort ändert sich. Konto und Umschlag bleiben zwei unabhängige Achsen; Kontoüberträge und Umbuchungen zwischen Umschlägen (`EnvelopeTransfer`) sind getrennte Vorgänge. Gebühren sind eine gewöhnliche Ausgabe.

Eine Sparrate sind damit zwei Vorgänge: die Zuteilung an den Umschlag und der Kontoübertrag. Das entspricht der Wirklichkeit — der Dauerauftrag läuft ohne die App, die Zuteilung macht die App. Wer beides in einem Schritt will, bekommt das als Abkürzung in der Oberfläche, nicht als gekoppelte Buchung.

## Abgleich

Beim Abgleich gibt der Nutzer den echten Kontostand ein; die App zeigt die Differenz zum berechneten Stand. Fehlende Buchungen lassen sich nacherfassen. Was danach noch offen ist, bucht "Differenz ausbuchen" als **Korrektur** (`AccountAdjustment`): eine eigene Buchungsart, die das Konto und "Zu verteilen" trifft, nie einen Umschlag.

Eine Korrektur ist kein Geldfluss, sondern das Eingeständnis, dass irgendwo etwas nicht erfasst wurde. Sie zählt darum **nicht** als Einnahme oder Ausgabe in Auswertungen. Danach stimmt das Konto wieder, und die Lücke steht dort, wo sie hingehört: beim freien Geld.

## Stichtag und Migration

`Household.ledgerSince` ist der gemeinsame Start von "Zu verteilen" **und** den Konten. Konten, die später dazukommen, haben ein eigenes Startdatum (siehe Anfangsbestände). Buchungen vor `ledgerSince` brauchen kein Konto und zählen wie in Stufe 1 nur in den Auswertungen; nur dort darf `accountId` leer sein.

Ein bestehender Haushalt führt Konten mit einem **neuen Stichtag** ein: Der OWNER gibt an einem Tag die echten Stände aller Konten ein, `ledgerSince` wandert auf diesen Tag, und "Zu verteilen" startet dort neu, abgeleitet wie oben. Die Umschlagsalden bleiben unverändert. Vor dem Bestätigen zeigt die App den bisherigen und den neuen Startwert von "Zu verteilen" ("bisher 412 €, neu 387 €"): Die Differenz ist, was bisher nicht erfasst war. Wie jede Verschiebung von `ledgerSince` bucht der Schritt zuerst alle fälligen Zuteilungen nach ([ADR-0005](0005-envelopes-as-unified-virtual-accounts.md), "Erst nachbuchen, dann ändern").

Ohne diesen Schritt würden die Anfangsbestände neuer Konten "Zu verteilen" zusätzlich gutgeschrieben, und das Geld wäre doppelt gezählt. Ein Haushalt ohne Konten bleibt darum bis zur Einführung in Stufe 1; die Datenbankmigration legt keine Konten an.

## Folgen

- `Household.openingBalance` wird zur abgeleiteten Größe; die Eingabe des Anfangsbestands aus PR #174 entfällt mit der Einführung der Konten.
- Die Invariante aus ADR-0005 wird überprüfbar: Die rechte Seite ist ab jetzt Σ Konten.
- Neue Buchungsarten: `AccountTransfer` (Konto → Konto) und `AccountAdjustment` (Konto ↔ "Zu verteilen"). Auswertungen von Einnahmen und Ausgaben berücksichtigen beide nicht.
- Für die Umsetzung entstehen eigene Issues.

## Verworfene Alternativen

- **Anfangsbestände und `openingBalance` getrennt eingeben.** Dieselbe Information doppelt gepflegt; die Differenz am ersten Tag wäre eine Abgleichsdifferenz ohne Aussage.
- **Ein gemeinsamer Stichtag für alle Konten, keine späteren Konten.** Ein Konto mit schon vorhandenem Geld (Sparschwein) wäre nicht abbildbar.
- **Ein Übertragsmodell mit optionalen Konto- und Umschlagseiten.** Die Sparrate wäre eine Buchung, aber die Achsen vermischen sich wieder: Jede Prüfung müsste vier Seiten und ihre Kombinationen kennen, und "Umbuchung" hieße mal das eine, mal das andere.
- **Harte Sperre auf gebundene Konten.** Für jede Ausnahme müsste erst der Umschlag bearbeitet werden; die Bindung wäre eine Buchhaltungsregel statt eines Eingabefilters.
- **Abgleichsdifferenz nur anzeigen, nie buchen.** Beim Bargeld kaum durchzuhalten; die Differenz bliebe für immer stehen.
- **Ein "Haushaltskonto" für alle bestehenden Buchungen.** Ein Teil davon war in Wirklichkeit Bargeld; der berechnete Stand passt nicht zur Bank, der erste Abgleich bucht die Differenz ohnehin als Korrektur. Ein künstliches Konto ohne Informationsgewinn.
- **Korrektur als Ausgabe aus einem Umschlag.** Verfälscht die Auswertungen und nimmt einem Zweck Geld, das nicht dafür ausgegeben wurde.
