# Family Funds

Family Funds ist eine Haushalts- und Finanzverwaltungs-App für mehrere Personen pro Haushalt.  
Die Anwendung unterstützt geplante Einnahmen, Fixkosten, Budgets, Sparziele und echte Buchungen.  
Authentifizierung läuft über Clerk, lokal kann die App aber auch im Mock-Modus ohne Clerk verwendet werden.

## Funktionen

- Mehrere Haushalte pro Benutzer
- Haushaltswechsel im Header
- Haushaltsverwaltung mit Mitgliedern und Einladungen
- Budgetierung mit wiederkehrenden Versionen pro Zeitraum
- Geplante Einnahmen
- Wiederkehrende Fixkosten
- Sparziele mit monatlicher Sparrate
- Transaktionen für Einnahmen und Ausgaben
- Monatsauswertung mit Budget- und Restbudget-Übersicht
- Mock-Auth für lokale Entwicklung ohne Clerk

## Tech-Stack

- Nuxt 4
- Vue 3
- TypeScript
- PrimeVue
- Clerk
- PostgreSQL
- Prisma

## Voraussetzungen

- Node.js 20 oder neuer
- Docker und Docker Compose
- Optional: Clerk Account für den echten Auth-Modus

## Schnellstart

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. PostgreSQL starten

```bash
docker compose up -d
```

### 3. Umgebung konfigurieren

Kopiere die Beispiel-Datei und passe sie an:

```bash
cp .env.example .env
```

Im lokalen Mock-Modus reicht in der Regel:

- `DATABASE_URL`
- keine Clerk-Keys

Wenn du Clerk nutzen willst, setze zusätzlich:

- `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NUXT_CLERK_SECRET_KEY`
- `NUXT_CLERK_WEBHOOK_SIGNING_SECRET`

### 4. Datenbank vorbereiten

```bash
npx prisma migrate dev
npx prisma generate
npx prisma db seed
```

### 5. Development Server starten

```bash
npm run dev
```

Die App läuft dann auf `http://localhost:3000`.

## Auth-Modi

### Mock-Modus

Wenn keine Clerk-Keys gesetzt sind, läuft die App im Mock-Modus:

- Login über lokale Test-User
- Session wird per Cookie gespeichert
- Ideal für Entwicklung ohne Clerk Dashboard

### Clerk-Modus

Wenn die Clerk-Keys gesetzt sind, verwendet die App Clerk für Authentifizierung:

- `/login` nutzt die Clerk Sign-in UI
- `/api/webhooks/clerk` synchronisiert Clerk-User mit der lokalen Datenbank
- Neue Nutzer bekommen beim ersten Login automatisch einen Start-Haushalt

Für lokale Webhooks brauchst du einen Tunnel, zum Beispiel mit `cloudflared` oder `ngrok`.

## Wichtige Scripts

```bash
npm run dev
npm run build
npm run generate
npm run preview
```

## Projektstruktur

- `app/` - Seiten, Layouts und Composables
- `server/` - Nuxt Server API und Middleware
- `prisma/` - Schema, Migrationen und Seed-Daten
- `public/` - Statische Assets
- `CONTEXT.md` - Technisches Handover und Projektkontext
- `.agent/` - Notizen und Planungsdokumente aus dem Projektverlauf

## Datenmodell

Die App speichert unter anderem:

- `User`
- `Household`
- `HouseholdMember`
- `HouseholdInvitation`
- `Budget`
- `BudgetVersion`
- `IncomePlan`
- `FixedCostPlan`
- `ExpenseTransaction`
- `IncomeTransaction`
- `SavingsGoal`
- `SavingsGoalExecution`

## Aktueller Fokus

Die Kernbereiche Auth, Haushaltskontext, Haushaltsverwaltung, Budgetierung und Transaktionen sind bereits implementiert.  
Als Nächstes stehen typischerweise weitere Auswertungen und Feinschliff im Frontend an.

## Hinweise

- `.env` wird nicht ins Repository committed.
- `.env.example` ist die Vorlage für neue Umgebungen.
- `node_modules/`, `.nuxt/` und `.output/` sind in der `.gitignore` ausgeschlossen.

