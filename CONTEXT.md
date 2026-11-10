# Finanz-App – Technisches Handover (Stand: Initiale Architekturentscheidung)

## Projektziel

Digitalisierung des manuellen Zettel-Trackings einer Familie. Mehrere Personen einer Family buchen Ausgaben auf gemeinsame Umschläge: mit periodischer Zuteilung (z.B. 250€/Woche Lebensmittel, 200€/Monat "Kinder") oder für spezielle Zwecke (z.B. 200€ Urlaub, 200€ Reparaturen).

Motivation:
* Bisher manuell auf einem Zettel zu Hause — Risiko, Übertragungen zu vergessen
* Mehrere Personen müssen von überall Zugriff haben (nicht nur am Zettel)
* Die Lösung soll auch anderen Haushalten zur Verfügung gestellt werden

### Geplante Funktionen

* Verwaltung von Fixkosten
* Verwaltung von Einnahmen
* Aufteilung des Geldes auf Umschläge (laufende Ausgaben, Fixkosten, Rücklagen, Sparziele, Persönliches)
* Erfassung von Ausgaben und Einnahmen, auf Wunsch aus einem Umschlag bzw. in einen Umschlag
* Umbuchungen zwischen Umschlägen
* Übersichten je Umschlag
* Monatsübersichten
* Unterstützung mehrerer Haushalte
* Unterstützung mehrerer Benutzer pro Haushalt
* Benutzer können Mitglied mehrerer Haushalte sein

---

## Architekturprinzipien

* Moderne Webanwendung
* Möglichst geringe Betriebskosten
* Keine Verwaltung eigener Server in Produktion
* Lokale Entwicklung mit Docker
* Authentifizierung über externen OIDC-konformen Dienst
* Saubere Trennung zwischen Authentifizierung und Fachlogik

---

## Technologie-Stack

### Frontend

* Nuxt 4
* Vue 3
* TypeScript

Begründung:

* Vorhandene Erfahrung mit Vue.js
* Hohe Produktivität
* Vollständiges Framework mit Routing, Server-API und Middleware

### Backend

* Nuxt Server API

Begründung:

* Für die erwartete Nutzerzahl ausreichend
* Keine zusätzliche Backend-Anwendung erforderlich
* Einfachere Entwicklung und Bereitstellung

### Datenbank

* PostgreSQL

### ORM

* Prisma

Begründung:

* Typsichere Datenbankzugriffe
* Gute Unterstützung für PostgreSQL
* Einfache Migrationen

---

## Hosting

### Produktion

#### Anwendung

* Vercel

Vorteile:

* Kostenloser Einstieg
* Git-basierte Deployments
* Kein Servermanagement

#### Datenbank

* Supabase PostgreSQL

Vorteile:

* Managed PostgreSQL
* Kostenloser Einstieg
* Automatische Backups und Verwaltung

---

## Authentifizierung

### Gewählte Lösung

* Clerk

### Anforderungen

* OIDC-kompatibel
* Externer Auth-Service
* Keine Passwortverwaltung innerhalb der Anwendung
* Möglichkeit zur späteren Migration auf andere OIDC-Anbieter

### Nicht Teil der Anwendung

* Passwortspeicherung
* Login-Implementierung
* MFA-Verwaltung

Diese Aufgaben werden vollständig von Clerk übernommen.

---

## Benutzer- und Haushaltsmodell

### Benutzer

Benutzer werden durch den Auth-Provider (Clerk / OIDC) verwaltet.

Die Anwendung speichert lediglich eine Referenz auf den OIDC-Benutzer.

Beispiel:

User

* id
* oidc_subject
* email
* display_name

Eigenschaften:

* Ein Benutzer kann beliebig vielen Haushalten angehören (Multi-Household-Membership, weil OIDC eine Identität pro User ist)
* Mindestalter für einen OIDC-Account: 13 Jahre (von Clerk durchgesetzt). Kinder unter 13 sind keine App-User, sondern erscheinen als Ausgabenkategorie
* Pro Haushalt können beliebig viele Benutzer buchen (realistisch 1-2 Eltern)

### Haushalt

Eine Personengruppe mit gemeinsamen Umschlägen (typisch eine Familie).

Household

* id
* name
* currency (Default-Währung des Haushalts, z.B. "EUR", "USD", "CHF")

### Haushaltsmitgliedschaften

HouseholdMember

* household_id
* user_id
* role (OWNER oder MEMBER)

Eigenschaften:

* Ein Benutzer kann mehreren Haushalten angehören
* Ein Haushalt kann mehrere Benutzer enthalten

Rollen:

* **OWNER**: verwaltet den Haushalt — Umbenennen, Currency, Löschen, Mitglieder einladen/rauswerfen und befördern, Umschläge anlegen, ändern, schließen und löschen
* **MEMBER**: bucht Ausgaben, Einnahmen und Umbuchungen, sieht Reports

Rollen-Übergänge:

* OWNER kann einen MEMBER zu OWNER befördern (typischerweise, um Verantwortung im Haushalt zu teilen)
* OWNER kann einen OWNER zu MEMBER downgraden — außer es ist der letzte OWNER (s. Constraint)

Constraint:

* Der letzte OWNER kann den Haushalt nicht verlassen — entweder jemand anders wird vorher OWNER, oder der Haushalt wird gelöscht. Ein Haushalt ohne OWNER ist nicht erlaubt.

---

## Fachliche Entitäten

### IncomePlan

Geplante Einnahmen.

### FixedCostPlan

Wiederkehrende Fixkosten.

### Umschlag (`Envelope`)

Virtuelles Konto mit Saldo: ein Teil des Haushaltsgelds für einen Zweck, kein Ort, an dem Geld liegt. Siehe [ADR-0005](docs/adr/0005-envelopes-as-unified-virtual-accounts.md).

* **Gruppe:** Laufende Ausgaben, Fixkosten, Rücklagen, Sparziele oder Persönlich. Sie steuert Darstellung und Vorgaben beim Anlegen, verbietet aber keine Eigenschaft.
* **Zuteilung** (optional): ein fester Betrag je Periode oder die Summe der verknüpften Fixkosten-Pläne, die in der Periode fällig werden, jeweils mit vollem Betrag (kein Ansparen). Die Frequenz ist unveränderlich; ein Wechsel heißt: neuer Umschlag, alten hinein schließen.
* **Sparziel** (optional): ein Zielbetrag.
* **Saldo:** wird nie gespeichert, sondern aus Buchungen summiert. Er bleibt über Perioden stehen, verfällt nie und darf negativ werden. Überzogen ist ein Umschlag erst mit negativem Saldo.
* **Gelb:** nur bei laufenden Ausgaben, wenn prozentual weniger als halb so viel Geld übrig ist wie Zeit in der Periode.
* **Schließen:** zu einem Stichtag (Periodenbeginn) in einen anderen Umschlag oder nach „Zu verteilen“. Der Endsaldo fließt als Verweis weiter, auch spätere Korrekturen von Buchungen vor dem Stichtag. Ab dem Stichtag keine Zuteilungen und keine Buchungen mehr.
* **Löschen** nur, solange der Umschlag keine Buchungen, Umbuchungen oder Vorgänger hat. Zuteilungen fließen dabei nach „Zu verteilen“ zurück.

### Zu verteilen

Das nicht verteilte Geld des Haushalts, genau einmal pro Haushalt, kein eigener Datensatz: `envelopeId = null` an einer Buchung, `null` auf einer Seite einer Umbuchung. Es zählt ab `Household.ledgerSince`; `openingBalance` ist das freie Geld zu diesem Zeitpunkt, zusätzlich zu dem, was dann schon in Umschlägen steckt.

Es gilt: Summe der Umschläge + Zu verteilen = Umschläge zum Stichtag + Anfangsbestand + Einnahmen − Ausgaben. Geschlossene Umschläge zählen nicht doppelt, ihr Saldo steckt im Ziel.

### Zuteilung und Vormerkung

Eine Zuteilung ist eine gebuchte Umbuchung aus „Zu verteilen“ in den Umschlag. Sie entsteht, sobald ihre Periode begonnen hat, beim nächsten Saldo-Abruf. Vergangene Zuteilungen liegen fest, eine geänderte Regel wirkt ab der nächsten noch nicht gebuchten Periode. Einzelne lassen sich ändern, 0 setzt eine Periode aus.

Geld hat drei Zustände: **verfügbar** (im Umschlag), **vorgemerkt** (wird im laufenden Kalendermonat noch zugeteilt, eine Woche gehört zum Monat ihres Montags) und **frei** (Zu verteilen abzüglich aller Vormerkungen).

### ExpenseTransaction

Tatsächliche Ausgaben.

### IncomeTransaction

Tatsächliche Einnahmen.

---

## Fachliche Grundregel

Geplante Werte und tatsächliche Buchungen werden getrennt gespeichert.

### Geplante Werte

* IncomePlan
* FixedCostPlan
* Zuteilungsregel und Sparziel eines Umschlags

### Tatsächliche Buchungen

* ExpenseTransaction
* IncomeTransaction
* EnvelopeTransfer

Dadurch bleiben Auswertungen und spätere Erweiterungen möglich.

### Planung

Alles, was der OWNER für künftiges Geld festlegt: die geplanten Werte, dazu das Schließen von Umschlägen und der Startpunkt von „Zu verteilen“. Das Gegenstück sind die tatsächlichen Buchungen.

Ändert sich an der Planung etwas, das eine Zuteilung betreffen kann, werden zuerst alle fälligen Zuteilungen nachgebucht. Ein Plan darf nicht über den Stichtag seines Umschlags hinauslaufen.

---

## Buchungs-Logik

### Ausgaben und Einnahmen (`ExpenseTransaction`, `IncomeTransaction`)

Kanonische Quelle für Reports ("Was haben wir diesen Monat ausgegeben?").

* `envelopeId` ist optional — ohne Umschlag treffen sie „Zu verteilen“
* Eine Ausgabe aus einem Sparziel ist eine normale Ausgabe mit dem Sparziel als Umschlag
* Eine Einnahme mit Umschlag ist eine Gutschrift auf diesen Umschlag und bleibt in den Reports eine Einnahme
* Buchungen aus einem Plan erben dessen Umschlag
* Neue oder umdatierte Buchungen müssen in die Laufzeit des Umschlags fallen
* Erfasst, wer gebucht hat (`userId`) und wann (`date`)

### Umbuchungen (`EnvelopeTransfer`)

Geld von einem Umschlag in einen anderen, `null` auf einer Seite heißt „Zu verteilen“. Es fließt kein Geld aus dem Haushalt ab, Umbuchungen erscheinen deshalb in keinem Report. Keine Beschränkung auf den verfügbaren Saldo, das UI warnt höchstens. Alle Mitglieder dürfen umbuchen; gebuchte Zuteilungen (`allocationPeriodStart`) ändert nur der OWNER.

---

## Onboarding

### Haushalt gründen

Jeder authentifizierte User kann einen neuen Haushalt erstellen. Beim Anlegen wird er automatisch OWNER.

### Mitglieder einladen

OWNER können weitere User per E-Mail einladen via `HouseholdInvitation`. Eingeladene User:

* starten als MEMBER
* können vom bestehenden OWNER zu OWNER befördert werden

### Erstregistrierung

Komplett neue User (noch kein Clerk-Account) durchlaufen den OIDC-Flow und können danach einen Haushalt gründen oder einer bestehenden Einladung folgen.

---

## Lokale Entwicklung

### Docker Compose

Enthaltene Services:

* Nuxt
* PostgreSQL

Optional:

* Keycloak für lokale OIDC-Tests

Die produktive Authentifizierung erfolgt jedoch über Clerk.

---

## Zukünftige Erweiterungsmöglichkeiten

* Kategorien für Einnahmen und Ausgaben
* Wiederkehrende Buchungen
* Haushaltsrollen und Berechtigungen
* Dateianhänge (Rechnungen, Belege)
* CSV-Import
* Bankdatenimport
* Mobile App auf Basis derselben API
* Benachrichtigungen bei überzogenen Umschlägen

---

## Zusammenfassung der Entscheidungen

| Bereich                        | Entscheidung           |
| ------------------------------ | ---------------------- |
| Frontend                       | Nuxt 4                 |
| Framework                      | Vue 3                  |
| Sprache                        | TypeScript             |
| Backend                        | Nuxt Server API        |
| Datenbank                      | PostgreSQL             |
| ORM                            | Prisma                 |
| Authentifizierung              | Clerk (OIDC)           |
| Hosting                        | Vercel                 |
| Datenbank-Hosting              | Supabase               |
| Lokale Entwicklung             | Docker Compose         |
| Benutzerverwaltung             | Externer Auth Provider |
| Mehrere Haushalte pro Benutzer | Ja                     |
| Mehrere Benutzer pro Haushalt  | Ja                     |
| Eigene Server in Produktion    | Nein                   |
| Buchungs-Logik                 | Umschläge mit Ausgaben, Einnahmen und Umbuchungen (ADR-0005) |
| Onboarding                     | Self-Service (Haushalt gründen oder per Einladung beitreten) |
| Rollenmodell                   | OWNER (verwaltet) / MEMBER (bucht), letzter OWNER unverletzlich |