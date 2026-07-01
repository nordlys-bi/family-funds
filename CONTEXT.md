# Finanz-App – Technisches Handover (Stand: Initiale Architekturentscheidung)

## Projektziel

Digitalisierung des manuellen Zettel-Trackings einer Familie. Mehrere Personen einer Family buchen Ausgaben gegen gemeinsame periodische Budgets (z.B. 250€/Woche Lebensmittel, 200€/Monat "Kinder") und legen Spartöpfe für spezielle Zwecke an (z.B. 200€ Urlaub, 200€ Reparaturen).

Motivation:
* Bisher manuell auf einem Zettel zu Hause — Risiko, Übertragungen zu vergessen
* Mehrere Personen müssen von überall Zugriff haben (nicht nur am Zettel)
* Die Lösung soll auch anderen Haushalten zur Verfügung gestellt werden

### Geplante Funktionen

* Verwaltung von Fixkosten
* Verwaltung von Einnahmen
* Verwaltung von Budgets für unterschiedliche Zeiträume
* Verwaltung von Sparplänen
* Erfassung von Ausgaben
* Anrechnung von Ausgaben auf Budgets
* Anrechnung von Ausgaben auf Sparziele
* Budgetübersichten
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

* Neon PostgreSQL

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

Eine Personengruppe mit gemeinsamem Budget-Set (typisch eine Familie).

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

* **OWNER**: verwaltet den Haushalt — Umbenennen, Currency, Löschen, Mitglieder einladen/rauswerfen und befördern, Budgets und SavingGoals anlegen/löschen
* **MEMBER**: bucht Ausgaben und Topf-Bewegungen, sieht Reports

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

### Budget

Periodischer Maximalbetrag für eine Ausgaben-Kategorie (z.B. 250€/Woche Lebensmittel, 200€/Monat "Kinder"). Budgets werden verbraucht; am Ende der Periode startet das Budget wieder bei 0.

### SavingsGoal

Ansparungs-Topf für einen bestimmten Zweck (z.B. "Urlaub 200€", "Reparaturen 200€"). Die App bildet **kein** Sparkonto ab — das Geld wird real beiseite gelegt (z.B. auf einem physischen Sparkonto), die App trackt nur die Reservierung. Mehrere `SavingsGoal`s können sich ein Sparkonto teilen.

Der aktuelle Stand eines Topfes ergibt sich aus der Summe aller `SavingsGoalExecution`s für diesen Topf.

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
* Budget
* SavingsGoal

### Tatsächliche Buchungen

* ExpenseTransaction
* IncomeTransaction

Dadurch bleiben Auswertungen, Forecasts und spätere Erweiterungen möglich.

---

## Buchungs-Logik

Die App unterscheidet zwei voneinander unabhängige Buchungs-Ströme:

### Tatsächliche Ausgaben (`ExpenseTransaction`)

Kanonische Quelle für Ausgaben-Reports ("Was haben wir diesen Monat ausgegeben?").

* `budgetId` ist optional — Ausgaben ohne Budget-Zuordnung sind erlaubt (Spontankäufe, Reisen außerhalb geplanter Budgets)
* Erfasst, wer gebucht hat (`userId`) und wann (`date`)

### Topf-Bewegungen (`SavingsGoalExecution`)

Kanonische Quelle für den Topf-Stand ("Wie voll ist der 'Urlaub'-Topf?").

* `amount` kann positiv (Ansparung) oder negativ (Entnahme) sein
* Der aktuelle Stand eines Topfes ist die Summe aller Executions

### Doppelbuchung

Eine Real-Aktion kann als zwei Buchungen erfasst werden: eine `ExpenseTransaction` (für das Reporting) und eine `SavingsGoalExecution` mit negativem Betrag (für den Topf-Stand). Beispiel: Eine 180€-Reise, die aus dem "Urlaub"-Topf bezahlt wird, erzeugt eine `ExpenseTransaction` und eine negative `SavingsGoalExecution`.

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
* Benachrichtigungen bei Budgetüberschreitungen

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
| Datenbank-Hosting              | Neon                   |
| Lokale Entwicklung             | Docker Compose         |
| Benutzerverwaltung             | Externer Auth Provider |
| Mehrere Haushalte pro Benutzer | Ja                     |
| Mehrere Benutzer pro Haushalt  | Ja                     |
| Eigene Server in Produktion    | Nein                   |
| Buchungs-Logik                 | ExpenseTransaction + SavingsGoalExecution (Doppelbuchung möglich) |
| Onboarding                     | Self-Service (Haushalt gründen oder per Einladung beitreten) |
| Rollenmodell                   | OWNER (verwaltet) / MEMBER (bucht), letzter OWNER unverletzlich |