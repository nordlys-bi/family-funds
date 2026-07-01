# Project State — Family Funds

Stand: M1–M5 implementiert, M6 Backend fertig (Frontend Lücke), M7 offen, M8 (Tests) in Arbeit.

## Letzter Commit
`28869c4 feat: introduce ListPageShell for consistent UI and add keyboard shortcuts for quick actions.`

## Architektur auf einen Blick

- **Nuxt 4** + Vue 3 + TypeScript, **PrimeVue (Aura Theme)**
- **PostgreSQL + Prisma** (13 Modelle, siehe `prisma/schema.prisma`)
- **Dual-Mode Auth**: Clerk OIDC (mit Webhook) ODER Mock-Cookie, je nach Env-Variablen
- **Nitro Server API** (kein separates Backend)

## Aktive Server-Endpoints

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/auth/mock-users` | Liste der Test-User (Mock-Mode) |
| POST | `/api/auth/login` | Session-Cookie setzen |
| POST | `/api/auth/logout` | Session-Cookie löschen |
| GET | `/api/auth/session` | Aktueller User |
| GET | `/api/households` | Haushalte des Users mit Rolle |
| POST | `/api/households` | Neuen Haushalt anlegen |
| PATCH | `/api/households/:id` | Haushalt umbenennen |
| POST | `/api/households/:id/members` | Mitglied hinzufügen |
| DELETE | `/api/households/:id/members/:mid` | Mitglied entfernen |
| DELETE | `/api/households/:id/invitations/:iid` | Einladung widerrufen |
| GET | `/api/households/current` | Aktiver Haushalt + BudgetOverview |
| POST/PATCH/DELETE | `/api/households/:id/planning` | CRUD für Budgets/Pläne (`kind`-Dispatch) |
| GET/POST/PATCH/DELETE | `/api/households/:id/transactions` | CRUD für Einnahmen/Ausgaben |
| POST | `/api/webhooks/clerk` | Clerk User-Sync (Svix-verifiziert) |

## Wichtige Utils

- `server/utils/planning.ts` — Money/Date/Parser, Period-Validation, Budget-Key-Generator
- `server/utils/budget-evaluation.ts` — Perioden-Berechnung, Month-Window, Overview-Aggregation
- `server/utils/transactions.ts` — Transaction-Kind-Validation
- `server/utils/household-access.ts` — `requireAuthenticatedUser`, `requireHouseholdMembership`, `requireHouseholdOwner`
- `server/utils/clerk-sync.ts` — User upsert + Invitations annehmen + Default-Haushalt
- `server/utils/auth-mode.ts` — `isClerkEnabled()` Env-Check

## Tests

Vitest-Suite in `server/utils/__tests__/`. Starten:
```bash
npm install
npm test           # watch
npm run test:run   # CI
npm run test:coverage
```

Coverage aktuell: `server/utils/*` (Pure Functions, kein Nuxt-Kontext nötig).

## Bekannte Lücken (Priorität)

1. **M6 Dashboard-Frontend**: `app/pages/index.vue` zeigt hardcoded Mock-Werte, sollte aber `current.get.ts` konsumieren
2. **M7 SavingsGoalExecution UI**: Schema da, keine UI zum Erfassen monatlicher Sparraten
3. **Multi-Household-Aggregation**: Kein Endpoint, der alle Haushalte eines Users mit kurzen Kennzahlen liefert
4. **API-Integration-Tests**: Aktuell nur Pure-Function-Tests. Auth-Middleware/Webhook/Endpoints mit DB sind ungetestet

## Wo sind die historischen Meilensteine?

- M1 Details: `.agent/walkthrough.md`
- M2–M5 Details: `.agent/implementation_plan.md`