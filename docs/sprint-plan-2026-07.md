# Sprint-Plan 2026-Q3 — Family Funds

**Stand:** 2026-07-09
**Horizont:** 2-3 Wochen (Beta-Sharing geplant)
**Modus:** Solo-Side-Project, Mobile-First Default
**Roadmap-Synthese:** `.reviews/2026-07-09-synthesis.md` (detaillierteste Quelle, priorisiert nach Cluster, Abhängigkeiten und Tester-Wert)

## Mission

Beta-Version von Family Funds auf einem Stand, der sich ohne Scham mit echtem Tester-Feedback testen lässt:

1. **Sicher + DSGVO-konform** — keine Account-Impersonation über DB-Leak (Mock-Auth-Hardening), automatische User-Löschung via Clerk-Webhook, kein Stacktrace-Leak via Error-Handler.
2. **Polished + WCAG-AA** — sichtbare Tastaturnavigation, `prefers-reduced-motion` respektiert, Dashboard nutzt das Design-System konsequent.
3. **Funktional komplett** — der Sparziel-Flow aus CONTEXT.md (Doppelbuchung ExpenseTransaction + SavingsGoalExecution) ist end-to-end ausführbar, nicht nur als Schema dokumentiert.
4. **Skaliert 1k+ Transaktionen pro Haushalt** — Indizes, Aggregates statt JS-Reduce, Pagination auf der Transaction-Liste.

## Issue-Landschaft (Stand 2026-07-09)

| # | Status | Sprint | Blocker | Titel |
|---|--------|--------|---------|-------|
| [#1](https://github.com/nordlys-bi/family-funds/issues/1) | CLOSED | — | — | PRD Frontend-Refactoring — Parent aller aktuellen Issues |
| [#6](https://github.com/nordlys-bi/family-funds/issues/6) | ready-for-agent | nach #22 + #13 | wartet auf finale Schließung | Dashboard-Frontend auf echte Daten |
| [#8](https://github.com/nordlys-bi/family-funds/issues/8) | ready-for-agent | Sprint 3 | none | Emoji-Lookup (emojilib + Domain-Map) |
| [#9](https://github.com/nordlys-bi/family-funds/issues/9) | CLOSED 2026-07-09 | Sprint 2 nach #24 | #24 | Transaktionslisten Monatsfilter |
| [#12](https://github.com/nordlys-bi/family-funds/issues/12) | ready-for-agent | Sprint 2 (optional) | #22 | Savings-Progress (Frontend) |
| [#13](https://github.com/nordlys-bi/family-funds/issues/13) | CLOSED 2026-07-09 | Sprint 2 | none | Empty-States (First-Time + No-Data) |
| [#14](https://github.com/nordlys-bi/family-funds/issues/14) | CLOSED 2026-07-09 | Sprint 2 | #21 (#21 lockt Layout aus) | Mobile Bottom-Nav statt Sidebar-Drawer |
| [#15](https://github.com/nordlys-bi/family-funds/issues/15) | CLOSED 2026-07-09 | Sprint 2 | none | Inline-Edit Transaktionen (Mobile-First) |
| [#16](https://github.com/nordlys-bi/family-funds/issues/16) | ready-for-agent | Sprint 3 | #13 + #14 | Onboarding-Tour (4-Step) |
| [#17](https://github.com/nordlys-bi/family-funds/issues/17) | ready-for-agent | **Sprint 1.1 (next)** | none | HMAC-signierter Session-Cookie |
| [#18](https://github.com/nordlys-bi/family-funds/issues/18) | ready-for-agent | Sprint 1 | none | `user.deleted`-Webhook + DSGVO |
| [#19](https://github.com/nordlys-bi/family-funds/issues/19) | ready-for-agent | Sprint 1 | none | A11y-Sweep global |
| [#20](https://github.com/nordlys-bi/family-funds/issues/20) | ready-for-agent | Sprint 1 | none | Login-Page-Refactor (LoginCard extrahieren) |
| [#21](https://github.com/nordlys-bi/family-funds/issues/21) | ready-for-agent | Sprint 1 | none | Dashboard-Migration auf Design-System |
| [#22](https://github.com/nordlys-bi/family-funds/issues/22) | ready-for-agent | Sprint 1 | **entblockt #12** | SavingsGoalExecution API + Dashboard-Bindung |
| [#23](https://github.com/nordlys-bi/family-funds/issues/23) | ready-for-agent | Sprint 2 | none | Composite-Indizes + `_sum`-Aggregates |
| [#24](https://github.com/nordlys-bi/family-funds/issues/24) | ready-for-agent | Sprint 2 | **blockt #9** | Pagination auf `GET .../transactions` |
| [#25](https://github.com/nordlys-bi/family-funds/issues/25) | ready-for-agent | Sprint 2 | none | `/api/households/current` Endpoint-Split |
| [#26](https://github.com/nordlys-bi/family-funds/issues/26) | ready-for-agent | Sprint 1 (Lückenfüller) | none | `requireHouseholdMembership` reduzieren |
| [#27](https://github.com/nordlys-bi/family-funds/issues/27) | ready-for-agent | Sprint 3 | none | DELETE-Endpoints splitten + einheitlicher Envelope |

Plus zwei aktive CLOSED Issues als historische Referenz: [#7](https://github.com/nordlys-bi/family-funds/issues/7) FAB Speed-Dial + Drawer (Vorgänger für #14 Bottom-Nav), [#10](https://github.com/nordlys-bi/family-funds/issues/10) ListView A/C Hybrid Polish.

## Sequenz (in dieser Reihenfolge ziehen)

### Sprint 1 — Beta-Vorbereitung (~6 Werktage)

```
1. #17 HMAC-Session-Cookie          [½ Tag, security, kein Blocker]
2. #26 Household-Include-Reduzieren [15 min, perf-Win, kein Blocker]
3. #18 user.deleted-Webhook          [½ Tag, DSGVO, kein Blocker]
4. #19 A11y-Sweep global             [1-2 Tage, WCAG, kein Blocker]
5. #21 Dashboard-Migration           [1 Tag, absorbiert FAB-Touch+ACTIV-Tag, kein Blocker]
6. #22 SavingsGoalExecution API      [½ Tag, entblockt #12]
7. #20 Login-Page-Refactor           [¼ Tag, polish nach A11y-Pass]
```

**Sprint-1-Done-Kriterium:**
- Beta-Version läuft mit HMAC-Session, DSGVO-konformem User-Delete, WCAG-AA-A11y, poliertem Dashboard + Login.
- Sparziel-Buchungs-Flow end-to-end ausführbar (POST Execution → Dashboard zeigt aktuellen Stand).
- Bug-Issues mit Label `bug` (#17, #18) landed.
- Smoke-Test auf Mobile (390×844) und Desktop (1440×900) durchläuft ohne Reibung.

### Sprint 2 — Skalierung + UX-Features (~5-6 Werktage)

```
8.  #23 Composite-Indizes + _sum     [½ Tag, Migration läuft CONCURRENTLY]
9.  #24 Transactions-Pagination      [½ Tag, blockt #9]
10. #25 current.get Endpoint-Split    [1 Tag, kein Blocker]
11. #9  Monatsfilter                  [½ Tag, sequenziell nach #24]
12. #13 Empty-States (First+No-Data)  [1 Tag, Pattern für Mobile-Workflow]
13. #14 Mobile Bottom-Nav             [1 Tag, folgt #21 + #13]
14. #15 Inline-Edit Transactions      [1 Tag, folgt #14 für konsistente Mobile-UX]
```

**Optional Sprint 2.5** bei Zeitüberschuss: **#12** Savings-Progress-Frontend (½ Tag, jetzt entblockt).

**Sprint-2-Done-Kriterium:**
- P95-Latenz `/api/households/:id/dashboard` < 50 ms bei 5k Transaktionen.
- Mobile-User können Buchungen inline korrigieren ohne Modal.
- Transaktionslisten haben funktionierenden Monatsfilter + Cursor-Pagination.
- Empty-States sind auf allen Hauptseiten konsistent.

### Sprint 3 — Tech-Debt + Polish (~3 Werktage)

```
15. #16 Onboarding-Tour              [1 Tag, folgt #13 + #14 für Content+Spotlight]
16. #27 DELETE-Split + Envelope      [1 Tag, OpenAPI-ready]
17. #8  Emoji-Lookup                 [½ Tag, Lückenfüller / nice-to-have]
```

**Plus jederzeit möglich:** **#6 schließen** mit Comment: „Erfüllt durch Phase 0 (Phase-0-Code in `git log`) + #22 (echte Savings-Aggregation) + #13 (Empty-States)".

**Sprint-3-Done-Kriterium:**
- API ist OpenAPI-generierbar (eine Route pro Resource).
- Neuer User wird durch 4-Step-Onboarding geführt.
- `#8` Polish deployed, kann auf Wunsch rausgeschoben werden.

## Harte Abhängigkeiten (Graph)

```
#17 ─┐
#18 ─┤
#19 ─┼─→ [Beta-Release]
#21 ─┤
#22 ─┼─→ #12 (Frontend)
     │
#26 ─┤  (Lückenfüller)
#20 ─┘

#23 ──→ #24 ──→ #9
              (Sequenz statt Parallel, weil gleicher Endpoint)

#13 ──→ #14 ──→ #15
#13 ──→ #14 ──→ #16
   └──── #16 (Onboarding braucht Empty-States als First-Time-Content)

#22 ──→ #12 (Frontend entblockt durch Backend)
```

## Reviewer-Findings (2026-07-09, drei Perspektiven)

Vollständige Listen in:
- `.reviews/2026-07-09-ux.md` (12 Findings, 3×P1, 5×P2, 4×P3)
- `.reviews/2026-07-09-ui.md` (12 Findings, 4×P1, 5×P2, 3×P3)
- `.reviews/2026-07-09-backend.md` (12 Findings, 4×P1, 5×P2, 3×P3)

**Phase-0-Quick-Wins bereits am 2026-07-09 umgesetzt** (Commits in `git log`):
- UX-3, UX-5, UX-7, UX-11, UX-12 (Login-Markdown, UUID-Slice-Tag, Aktiv-Tag, Empty-Banner-Text, roleLabel-Helper)
- UI-1-1 (20 Icon-Buttons mit aria-label)
- Backend-1-4 (TOCTOU → upsert in `planning.patch.ts`)
- Backend-3-12 (UUID-Path-Validierung via `parseUuidParam` in 14 Endpoints, Error-Handler-Plugin)

**Bewusst nicht in Sprint** (geparkt):
- UX-P1-1 FAB Quick-Add — wird durch Bottom-Nav (#14) obsolet oder umgestaltet; nach #14 neu bewerten.
- UI-P3-10/11/12 — Mikro-Polish, wartet auf größeren Refactor.

## Wie eine neue Mavis-Session aufsetzt

1. **Lies diese Datei zuerst** — sie definiert das Sprint-Ziel und die Sequenz.
2. **Prüfe Issue-Status** mit `gh issue list --label "ready-for-agent"` — die Sequenz oben nennt die nächste Nr.
3. **Check Memory** in `~/.mavis/agents/mavis/memory/MEMORY.md` — enthält gotchas aus früheren Sessions in diesem Projekt (PrimeVue-Collision-List, Nuxt-Routing, Vue-Optional-Chaining-Quirks).
4. **Vor jedem Commit**: `npx vitest run` (127 Tests als Baseline, mit `validation.test.ts` aus Phase 0).
5. **Bei Tester-Feedback** (Beta läuft): Issues #14 (Bottom-Nav) und #22 (Savings-Execution) sind die, die am stärksten von Real-World-Input profitieren — die zuerst nach Feedback anpassen.

## Offene Fragen / bekannte Risiken

- **Beta-Datum** noch nicht final — bestimmt, ob Sprint 1 vor Beta-Sharing durch ist oder nach Beta-Feedback Phase 2 startet.
- **Tester-Pool**: aktuell nur Jan (OWNER) und Sarah (MEMBER). MEMBER-Pfade sind in den Reviews weniger abgedeckt — Beta-Tutorial sollte gezielt Sarah-Persona testen.
- **Light-Mode**: Token-System vorbereitet, aber Layout default `dark`. Vor V1.0 nochmal als eigenes Issue anlegen, nicht in Sprint.
- **Mobile-Bottom-Nav-Entscheidung** (in #14): Tablet-Breakpoint (640-1024px) — Bottom-Nav oder Sidebar? Spec sagt Bottom-Nav, kann nach Tester-Feedback revidiert werden.

## Changelog

- **2026-07-09:** Initial-Plan erstellt aus 3-Perspektiven-Synthese, 19 Issues angelegt + triagiert, Sprint-Sequenz festgelegt.
- **2026-07-09:** Issue #9 (Transaktionslisten Monatsfilter) abgeschlossen — Backend `?month=YYYY-MM` mit Validation, Composable `useTransactionList` extrahiert (gemeinsamer State für expenses + income), Monats-Spinner mit URL-Sync in beiden Pages. 53 neue Tests (von 190 auf 243).
- **2026-07-09:** Issue #13 (Empty-States) abgeschlossen — `EmptyState` um `variant`/`icon`/`headline`/`description`/`cta`/`icon-tone`-Props erweitert; First-Time + No-Data-States in 5 Pages (expenses, income, budgets, savings, recurring, members). First-Time-Logik via `isFirstRun(activeHousehold)` (Schwelle 7 Tage). 12 neue Tests (von 243 auf 255). Out-of-Scope: Skeleton-Loading-States — Pattern ist vorbereitet (`loadingVariant="skeleton"` + `#loading-skeleton` Slot), aber Pages rendern weiter Spinner.
- **2026-07-09:** Issue #14 (Mobile Bottom-Nav) abgeschlossen — neue Komponente `MobileBottomNav.vue` mit 4 primären Items + "Mehr"-Bottom-Sheet, `default.vue` Layout zeigt Sidebar nur noch auf Desktop (>= 1024px), Tablet bekommt Bottom-Nav statt Sidebar. Hamburger-Button + Backdrop-Logik entfernt. FAB-Speed-Dial aus #7 bleibt funktional.
- **2026-07-09:** Issue #15 (Inline-Edit Transaktionen) abgeschlossen — neue Komponente `TransactionRowEditor.vue` (Betrag, Beschreibung, Datum, Budget + Save/Cancel), Single-Edit-Pattern in expenses/income (genau eine Zeile im Edit-Modus gleichzeitig), ESC bricht ab, Optimistic Update mit Server-Rollback. Edit-Icon triggert Inline-Edit statt Dialog-Edit; Create-Pfad bleibt im Dialog. Composable `useTransactionList` um `updateTransactionLocal` / `restoreTransactionLocal` / `recomputeSummaryFromLocal` erweitert.
