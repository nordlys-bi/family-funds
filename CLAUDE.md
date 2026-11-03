# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Family Funds is a household finance app (Nuxt 4 / Vue 3 / TypeScript, PrimeVue, Prisma + PostgreSQL, Clerk for auth). Multiple households, multiple members per household, planned values (envelopes with allocations and savings targets, income plans, fixed costs) vs. actual bookings (expense/income transactions, transfers). See [CONTEXT.md](CONTEXT.md) for the full domain glossary and concept model — read it before making domain-modeling decisions, and read relevant [docs/adr/](docs/adr/) entries before touching the area they cover. Comments in the codebase are written in German and are usually rationale ("why"), not description — read them before changing the code they annotate.

## Commands

```bash
npm install                # install deps
docker compose up -d       # start local PostgreSQL (and optional Keycloak)
cp .env.example .env       # configure environment (mock-auth needs only DATABASE_URL/DIRECT_URL)
npx prisma migrate dev     # apply migrations locally
npx prisma db seed         # seed local DB (prisma/seed.ts)
npm run db:seed:demo       # (re)create only the "Familie Demo" household with ~3 months of data; keeps other data

npm run dev                # dev server on :3000 (runs `prisma migrate deploy && prisma generate` first)
npm run build               # production build
npm run preview

npm test                    # vitest watch mode
npm run test:run            # vitest single run
npm run test:coverage       # vitest with coverage (coverage.include is server/utils/**)
npx vitest run path/to/file.test.ts             # single file
npx vitest run -t "test name"                   # single test by name

npm run db:status           # prisma migrate status
npm run db:migrate          # prisma migrate dev
```

Tests never require a running database: server tests mock `server/utils/prisma` and `server/utils/household-access` via `vi.mock`/`vi.hoisted` (see any `__tests__/*.test.ts`). `pretest` only runs `prisma generate` (via `scripts/prisma-pretest.mjs`, which falls back to a placeholder `DATABASE_URL` on a fresh checkout so `npm test` works without `.env`).

## Architecture

### Auth: dual-mode (Clerk vs. Mock), decided at build time

`nuxt.config.ts` sets `isClerkEnabled` from `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `NUXT_CLERK_SECRET_KEY` and conditionally registers the `@clerk/nuxt` module; the result is exposed as `runtimeConfig.public.authMode` (`'clerk'` | `'mock'`). Both server middlewares (`server/middleware/clerk.ts`, `server/middleware/auth.ts`) branch on this at request time and **dynamically import** `@clerk/nuxt/server` only in Clerk mode — a static import would break mock mode because of a broken Node-ESM entry point in that package version. `server/utils/auth-mode.ts` (`isClerkEnabled()`) duplicates the check for places that need it outside the Nuxt config context.

- Clerk mode: `event.context.auth()` from Clerk, synced on demand into the local `User` table (`server/utils/clerk-sync.ts`); `/api/webhooks/clerk` keeps it in sync asynchronously.
- Mock mode: an HMAC-signed `session_user_id` cookie (`server/utils/auth-session.ts`), issued by `POST /api/auth/login` against local test users.

Server endpoints authorize via `server/utils/household-access.ts`: `requireAuthenticatedUser`, `requireHouseholdMembership` (any role), `requireHouseholdOwner` (OWNER only — renaming/deleting the household, managing members, envelopes, plans). `app/middleware/auth.global.ts` handles client-side redirect to `/login` and ensures household context is loaded before any page renders.

### Household context

A user can belong to multiple households; every domain entity hangs off a `householdId`. The active household is client-side state in `app/composables/useHousehold.ts` (a Nuxt `useState`, persisted via an `active_household_id` cookie), not a URL param — server endpoints take `householdId` as a route param and re-check membership per request regardless of what the client claims is active.

### Envelopes: planned vs. actual

Money lives in **envelopes** (`Envelope`, UI: "Umschlag"), virtual accounts with a running balance. See [ADR-0005](docs/adr/0005-envelopes-as-unified-virtual-accounts.md), the reference for everything below. "Konto" is reserved for real accounts (a later stage). All money fields are integer cents.

- An envelope has one **group** (`RUNNING`, `FIXED`, `RESERVE`, `SAVINGS`, `PERSONAL`). It controls display and creation defaults but forbids nothing: allocation rule and savings target (`targetAmount`) are independent optional properties.
- **"Zu verteilen"** is the implicit per-household pot for unassigned money: `envelopeId: null` on a booking, `null` on one side of a transfer. It counts from `Household.ledgerSince`; `openingBalance` is the free money at that point.
- **Balances are never stored**: they are a per-request sum over bookings (`server/utils/envelope-balance.ts`). A closed envelope's balance flows into `carryoverToEnvelopeId` (or "Zu verteilen") as a live reference, not a booked amount.
- **Allocations are booked, not computed**: an `EnvelopeTransfer` from "Zu verteilen" with `allocationPeriodStart`. `ensureAllocations` (`server/utils/envelope-store.ts`) creates due ones lazily before any balance read, and must also run before any change to a rule, plan or closing date, otherwise a started but unbooked period gets the new amount. Skipping a period means amount 0, never deleting the row. An envelope that gets its first rule later starts at the next period (`allocationsSince`), never retroactively. Upcoming allocations of the calendar month are "vorgemerkt": computed, and subtracted from what is free.
- **Rating is by balance** (`classifyEnvelopeSeverity`): red only when the balance is negative. Yellow only for running expenses, when less than half as much money as time is left in the period. There is no forecast.
- `FixedCostPlan`/`IncomePlan` link to their transactions via an explicit FK (`fixedCostPlanId`/`incomePlanId`, `onDelete: SetNull`) rather than heuristic matching, so "coverage" is a per-request aggregation over real rows. See [ADR-0002](docs/adr/0002-recurring-plan-coverage.md). A plan's `envelopeId` is inherited by bookings created from it, and an envelope with `allocationSource: PLANS` derives its allocation from its plans. Period bucketing lives in `server/utils/period.ts` and `recurring-periods.ts`.
- Expense/income transactions are soft-deleted (`deletedAt`, restorable via `POST .../restore`); nearly every query must filter `deletedAt: null`.
- `Budget`, `BudgetVersion`, `SavingsGoal`, `SavingsGoalExecution` and `budgetId` are legacy, kept only until the production cutover so `scripts/verify-envelope-migration.ts` can compare against them. Never write to them.

### API conventions

REST-ish routes under `server/api/households/[householdId]/...`, filename-encoded HTTP method (`*.get.ts`, `*.post.ts`, `*.patch.ts`, `*.delete.ts`). Mutation responses (POST/PATCH/DELETE) are wrapped via `defineApiResponse()` (`server/utils/api-response.ts`) as `{ data: T, meta? }`; errors go through h3's `createError`. GET endpoints predate this convention and may still return raw shapes. DELETE endpoints take the resource id as a path param, never a body (CORS strips DELETE bodies in some clients). Route params are validated with `parseUuidParam` (`server/utils/validation.ts`).

### Frontend structure

Nuxt 4 app-dir layout: `app/pages/` (routes), `app/components/` (PrimeVue-based UI), `app/composables/` (state + data fetching, `useState`-backed so state survives SSR/navigation), `app/utils/` (pure formatting/helpers, unit-tested alongside). PrimeVue components must be explicitly whitelisted in `nuxt.config.ts` (`primevue.components.include`) or they render as unknown elements.
