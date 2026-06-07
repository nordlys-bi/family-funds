# Finanz-App – Technisches Handover (Stand: Initiale Architekturentscheidung)

## Projektziel

Entwicklung einer Webanwendung zur Verwaltung privater Finanzen für Einzelpersonen und Haushalte.

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

Benutzer werden durch den Auth-Provider verwaltet.

Die Anwendung speichert lediglich eine Referenz auf den OIDC-Benutzer.

Beispiel:

User

* id
* oidc_subject
* email
* display_name

### Haushalt

Household

* id
* name

### Haushaltsmitgliedschaften

HouseholdMember

* household_id
* user_id
* role

Eigenschaften:

* Ein Benutzer kann mehreren Haushalten angehören
* Ein Haushalt kann mehrere Benutzer enthalten

---

## Fachliche Entitäten

### IncomePlan

Geplante Einnahmen.

### FixedCostPlan

Wiederkehrende Fixkosten.

### Budget

Budget für einen definierten Zeitraum.

### SavingsGoal

Sparziel mit Zielbetrag und geplanter Sparrate.

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
