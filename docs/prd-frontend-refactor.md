# PRD: Frontend-Refactoring & Design-System

**Status:** ready-for-agent
**Priorität:** mittel
**Bezug:** `docs/frontend-refactor.md` (detaillierter Implementierungs-Plan, granular pro Phase)
**Kontext:** Side-Project, Solo-Entwicklung, Mobile-First ab jetzt Default. Dateneingabe unterwegs (Supermarkt, Café) ist der wichtigste Use-Case.

## Problem Statement

Das Frontend der App ist fachlich vollständig (Haushaltsverwaltung, Planung, Buchungen), aber im UX- und Code-Zustand problematisch. Konkret:

- **Zu viel Information pro Seite**: Die Planning-Seite packt 4 fachlich getrennte Domänen (Budgets, Einnahmen, Fixkosten, Sparziele) in eine Datei mit jeweils eigenem Modal. Die Transaktions-Seite vermischt Einnahmen und Ausgaben in einer Liste.
- **Design-Inkonsistenzen**: Fünf handgeschriebene Varianten des gleichen "Eyebrow"-Patterns, drei unterschiedliche Empty-State-Stile, inkonsistente Währungs-Inputs, M3/M4/M5-Dev-Marker im User-UI, hardgecodete Mock-Statistiken auf dem Dashboard.
- **Sichtbarer Theme-Bug**: Selects in Modals werden weiß statt dunkel dargestellt. PrimeVue Aura Theme-Variablen werden von klassenbasierten Overrides nicht ausreichend überschrieben.
- **Mobile nicht mitgedacht**: Quick-Add für unterwegs fehlt komplett. Touch-Targets teilweise < 36px, Sidebar ist kein echtes Drawer, Modals sind nicht full-screen, 5+ inkonsistente Breakpoints.
- **Dashboard zeigt keine echten Daten**: Hardgecodete Mock-Werte, plus ein "Nächste Entwicklungsschritte"-Panel mit Dev-Milestones — beides nicht user-facing.

In Summe: Die App funktioniert, fühlt sich aber weder konsistent noch für den primären Use-Case (schnelle Buchung unterwegs) optimiert an.

## Solution

Drei-Phasen-Refactor des Frontends, mit einem neuen Backend-Endpoint für das Dashboard. Mobile-First als Querschnitt, nicht nachgereicht.

**Phase 1 — Design-System-Grundlage.** Theme-Bug strukturell fixen (semantische Tokens für Dialog/Select/Input-Background), zentrale Token-Datei für alle visuellen Konstanten, einheitliche globale Styles, `<Kicker>`-Komponente statt 5 handgeschriebener Varianten, M3/M4/M5-Dev-Marker raus.

**Phase 2 — Komponenten extrahieren.** Den duplizierten Boilerplate (Listen-Panels, Item-Cards, Empty-States, Form-Felder, Confirm-Dialog, Money-Input, Tag-Komponenten, hierarchische Nav-Section) in gemeinsame Komponenten heben. Plus den neuen `<FabSpeedDial>` für die Quick-Add-Action auf Mobile.

**Phase 3 — Pages umstrukturieren.** Planning in 3 Sub-Routen aufteilen (Budgets / Recurring / Savings), Transaktionen in 2 Sub-Routen (Expenses / Income), Households in 3 Sub-Routen (Übersicht / Mitglieder / Settings). Dashboard auf den neuen Backend-Endpoint umstellen, Mock-Daten und Dev-Roadmap raus. Sidebar hierarchisch mit `<NavSection>`.

## User Stories

### Dashboard
1. As a family member, I want to see the active household clearly identified on the dashboard, so that I know I'm looking at the right context.
2. As a family member, I want to see this month's income, expenses, and net balance on the dashboard, so that I understand my financial state without navigating elsewhere.
3. As a family member, I want to see a warning when a budget is approaching or exceeding its planned amount, so that I can adjust my spending before it becomes a problem.
4. As a family member, I want to see my most recent transactions on the dashboard, so that I can quickly verify the latest entries without opening the full list.
5. As a family member, I want to see the progress of my savings goals on the dashboard, so that I know how close I am to my targets.
6. As a family member, I want to see clear empty states when I have no budgets, transactions, or savings goals yet, so that I know what to do next.
7. As a family member, I do NOT want to see hardcoded fake statistics on the dashboard, so that I can trust what I see.
8. As a family member, I do NOT want to see development milestones (M3/M4/M5) or a roadmap panel, so that the app feels finished rather than like a developer tool.

### Quick-Add (Mobile)
9. As a family member on mobile, I want a single floating action button visible on every page, so that I can start recording a transaction without navigating to a specific screen.
10. As a family member on mobile, I want tapping the FAB to open a small submenu with the most common actions (expense, income, savings goal), so that I can pick the right one quickly.
11. As a family member on mobile, I want the FAB submenu to be visually clear (mini-buttons arranged in a quarter-circle, with labels), so that I know which action is which without trial and error.
12. As a family member on mobile, I want the quick-add form to be a full-screen bottom sheet, so that the on-screen keyboard doesn't cover the save button.
13. As a family member on mobile, I want the amount input to use the numeric keyboard, so that I can type the value quickly with one hand.
14. As a family member on mobile, I want the budget selector to appear only for expenses, so that I don't have to dismiss irrelevant fields.
15. As a family member on mobile, I want the save button to be sticky at the bottom of the sheet, so that I can submit the form without scrolling.
16. As a desktop user, I want the same quick actions available via a split-button in the toolbar, so that the action set is consistent across devices.

### Navigation
17. As a family member, I want to navigate between Dashboard, Planning, and Transactions, so that I can access each area of the app.
18. As a family member, I want planning split into Budgets, Recurring (income/fixed costs), and Savings, so that each area has a focused, single-purpose view.
19. As a family member, I want transactions split into Expenses and Income, so that I can focus on one type at a time.
20. As a family member, I want household management split into Overview, Members, and Settings, so that each area has its own focus.
21. As a family member, I want the sidebar to show planning and transactions as hierarchical sections with their sub-routes nested underneath, so that the structure mirrors the domain.
22. As a family member, I want the currently active sub-route to be highlighted in the sidebar, so that I always know where I am.
23. As a family member with bookmarks on the old planning/transactions URLs, I want them to redirect to the new locations, so that I don't get lost.

### Design-System & Konsistenz
24. As a family member, I want all forms in the app to look the same, so that the app feels consistent and predictable.
25. As a family member, I want currency inputs to use German formatting (decimal comma, currency symbol), so that amounts display the way I'm used to.
26. As a family member, I want all buttons to be tappable on mobile (minimum 44×44pt), so that I can use the app with my fingers without missing buttons.
27. As a family member, I want consistent empty states across the app, so that I always know what to do when there's no data.
28. As a family member, I want consistent visual labels (eyebrow text) across the app, so that the hierarchy is clear at a glance.

### Mobile-First
29. As a family member on mobile, I want the navigation to slide in as a drawer with a backdrop, so that I have more screen space for content.
30. As a family member on mobile, I want dialogs to take the full screen, so that forms are easy to fill out without scrolling.
31. As a family member on mobile, I want only 2 layout breakpoints (mobile vs. desktop) instead of many inconsistent ones, so that the app behaves predictably across screen sizes.
32. As a family member on mobile, I want the dashboard to stack as single cards instead of a grid, so that each insight is easy to read on a small screen.

### Confirmations & Sicherheit
33. As a household owner, I want a confirmation dialog before removing a member, so that I don't accidentally lose data.
34. As a household owner, I want a confirmation dialog before cancelling an invitation, so that the invited person doesn't get confused.

## Implementation Decisions

### Neuer Backend-Endpoint
- **Ein neuer Endpoint** liefert die aggregierte Dashboard-Sicht: aktueller Monats-Snapshot (Einnahmen, Ausgaben, Saldo, Summe ohne Budget), Budget-Warnungen (mit Ampelsystem: ok / warning bei ≥ 80 % / over bei > 100 %), letzte 5 Transaktionen der letzten 7 Tage, Sparziel-Progress (current/target). Response in Cent.
- **Wiederverwendung** der bestehenden Budget-Aggregation-Logik für die "planned vs. spent"-Berechnung. Keine neue Aggregations-Logik schreiben.
- **Wiederverwendung** der bestehenden Monats-Fenster-Utility für konsistente Zeitfenster-Berechnung.
- **Auth** mit dem gleichen `requireHouseholdMembership`-Helper wie die anderen Household-Endpoints.

### FAB Speed-Dial
- **Material-Design-Pattern** statt Long-Press. Haupt-FAB (56×56, rund) plus 3 Mini-FABs im Viertelkreis (90°-Bogen) darüber/rechts daneben.
- **3 feste Aktionen** im Submenü: Ausgabe (rot), Einnahme (grün), Sparziel anlegen (blau). "Budget anlegen" ist NICHT im Speed-Dial, weil der Viertelkreis sonst zu eng wird — es bleibt über das normale Budgeting-UI erreichbar.
- **Animationen**: Haupt-Icon rotiert 45° (+ → ×) beim Öffnen, Mini-FABs erscheinen mit 50ms-Stagger per Scale + Translate, Labels faden ein. Tap-outside oder ESC schließt.
- **Desktop-Verhalten**: FAB versteckt via Media-Query. Stattdessen bekommt der existierende "Neu"-Button im Toolbar den gleichen Split-Button-Treatment (Hauptklick = Ausgabe, Dropdown-Pfeil = 3+1 Aktionen). Konsistente Aktionen, andere Metapher.

### Komponenten-Architektur
- **Alle 5 existierenden Eyebrow/Kicker-Varianten** werden durch eine einzige `<Kicker>`-Komponente ersetzt.
- **Alle 3+ Empty-State-Varianten** werden durch eine `<EmptyState>`-Komponente ersetzt (mit Slot für CTA-Button).
- **`<ListPanel>`** ersetzt die `.list-panel` / `.plan-panel`-Blöcke über alle Pages.
- **`<ItemCard>`** ersetzt die `.item-card`-Wiederholung.
- **`<FormDialog>` + `<FormField>`** kapseln das PrimeVue-Dialog-Styling und sorgen für konsistente Form-Layouts.
- **`<ConfirmDialog>`** ersetzt die nativen `window.confirm()`-Aufrufe.
- **`<MoneyInput>`** kapselt `InputNumber mode="currency" locale="de-DE"` — wird überall verwendet, ersetzt die inkonsistenten InputText/InputNumber-Verwendungen.
- **`<NavSection>`** für die hierarchische Sidebar mit Active-State-Logik über Sub-Routen.
- **`<FabSpeedDial>`** als eigene Komponente, im `default.vue`-Layout platziert (nicht in einzelnen Pages), damit der FAB automatisch überall sichtbar ist.
- **`<BottomSheet>`** als Wrapper um PrimeVue Dialog (Position: bottom), für mobile Full-Screen-Formulare.

### Theming
- **Eine zentrale Token-Datei** mit CSS-Variablen für alle visuellen Konstanten: Farben (Panel-BG, Input-BG, Modal-BG, Text-Tones, Border, Akzente), Spacing, Radius, Touch-Target-Größe.
- **Semantische PrimeVue-Tokens** im Theme-Config so setzen, dass Dialog/Select/Input-Backgrounds explizit auf die Dark-Variante gezwungen werden. Das fixt den weißen-Select-Bug strukturell.
- **Mobile-First Tokens**: Basis-Spacing für 360px-Viewport, Desktop-Overrides ab 640px.
- **Nur 2 Breakpoints** (mobile < 640px, desktop ≥ 640px). Die existierenden 5+ verschiedenen Breakpoints werden vereinheitlicht.

### Routing & Redirects
- **Sub-Routen** statt Tabs: saubereres Deep-Linking, klare 1:1-Verantwortung pro Page.
- **Redirect per `definePageMeta`** für die alten URLs (kein Server-Middleware, kein 301). Begründung: keine externen Links, kein SEO-Bedarf, einfacher zu revertieren.

### Architektur-Entscheidungen (in dieser Runde getroffen)
| Frage | Entscheidung |
|---|---|
| Navigation für Planning und Transaktionen | Sub-Routen |
| Confirm-Dialog | Eigene Komponente statt PrimeVue `useConfirm()` |
| Dashboard-Daten | Eigener Backend-Endpoint |
| Mobile-First | Default ab jetzt, Dateneingabe unterwegs ist wichtigster Use-Case |
| FAB-Pattern | Material Speed-Dial statt Long-Press |
| Sidebar-Struktur | Hierarchisch mit `<NavSection>` |
| Dashboard-Logik | Statisch (keine User-Config) |
| Migrations-Pfad | `definePageMeta` Redirect |

## Testing Decisions

### Was gute Tests ausmacht
- **Nur externes Verhalten testen, keine Implementierungs-Details.** Keine Snapshots, keine internen Refactors brechen Tests.
- **Realistische Daten.** Tests sollen gegen die echte Datenbank laufen (oder eine In-Memory-Variante), nicht gegen schwer zu pflegende Mocks.

### Test-Seam
- **Genau eine neue Test-Seam**: HTTP-Integration-Tests für den neuen Dashboard-Endpoint. Höchste Seam für die einzige Stelle mit echter neuer Logik. Erkennt falsche Aggregationen, falsche Filter, Auth-Bugs, fehlende Edge-Cases.
- **Wiederverwendung** des bestehenden vitest-Setups. Neues File-Pattern: `*.integration.test.ts` in `server/api/households/[householdId]/__tests__/`. Kein neues Test-Framework, keine Playwright-Infra.
- **Test-Pattern**: Direkter Aufruf des Event-Handlers mit einem synthetischen Event-Objekt + Test-Datenbank. Folgt dem Stil der existierenden Server-Utility-Tests, eine Ebene höher (HTTP statt pure functions).

### Was bewusst NICHT getestet wird
- **Komponenten-Tests** für die refactoreten Komponenten: Refactor ist behavior-preserving, ohne Browser-Setup wären Tests fragil, geringer Mehrwert.
- **E2E-Tests** mit Playwright: zu viel Infrastruktur für ein Side-Project.
- **Frontend Utility-Tests**: keine bestehende Test-Infrastruktur im Frontend, würde eine zweite neue Seam eröffnen.
- **Visuelle Regressionstests** / Storybook: explizit ausgeschlossen (Side-Project-Scope).

### Test-Cases für den Dashboard-Endpoint
- **Happy Path**: 1 Haushalt, 3 Budgets (1× ok, 1× warning bei ≥ 80 %, 1× over bei > 100 %), 2 Ausgaben letzte Woche, 1 Sparziel mit teilweise erreichten Ziels.
- **Empty State**: kein Budget, keine Buchungen, keine Sparziele → leere Arrays, `incomeTotal = 0`, etc.
- **Auth**: Aufruf durch User ohne Haushalts-Mitgliedschaft → 403.
- **7-Tage-Fenster**: Buchung älter als 7 Tage erscheint NICHT in `recentActivity`, aber sehr wohl in den Monats-Summen.
- **Sonstiges-Bucket**: Ausgaben ohne Budget-Zuordnung tauchen NICHT in den `budgetAlerts` auf (Catch-All-Kategorie, keine Warnung).
- **Severity-Klassifikation**: Grenzwerte präzise testen — exakt 80 % = warning, exakt 100 % = warning, > 100 % = over.

## Out of Scope

- **PWA / Offline-Support** — würde Service-Worker-Setup erfordern.
- **Push-Notifications** — kein Use-Case im aktuellen Scope, würde Backend-Änderungen brauchen.
- **Kamera-Integration** für Belege — explizit als zukünftige Erweiterung in `CONTEXT.md` aufgeführt, nicht Teil dieses Plans.
- **Haptisches Feedback** — nice-to-have, kein klarer Mehrwert für ein Single-User-Produkt.
- **Swipe-Gesture-Handling** jenseits Drawer-Open/Close — zu komplex für den aktuellen Bedarf.
- **Storybook / visuelle Tests** — zu viel Overhead für ein Side-Project.
- **Performance-Optimierungen** (Code-Splitting, Lazy-Loading, Virtualisierung) — kommen separat, wenn nötig.
- **Neue Bibliotheken** — das bestehende Setup (Nuxt 4 + Vue 3 + PrimeVue 4 + PrimeIcons) reicht. Kein Tailwind, kein Headless-UI, kein eigenes Design-System-Framework.
- **M7 (SavingsGoalExecution UI)** — separates Feature, nicht Teil dieses Refactor-PRDs. Im bestehenden Project-State als eigene Lücke aufgeführt (`M7`).
- **Multi-Household-Aggregation** — separater Endpoint für User-übergreifende Übersicht, nicht Teil dieses Refactor-PRDs. Im bestehenden Project-State als eigene Lücke aufgeführt.
- **TypeScript-Refactorings** jenseits dessen, was die Komponenten-Extraktion mit sich bringt.

## Further Notes

- **Bezug zum Implementierungs-Plan**: `docs/frontend-refactor.md` enthält die granularen Phasen und Checkboxen. Dieses PRD ist die High-Level-Sicht, der Plan ist die taktische Sicht. Bei Konflikten gewinnt der Plan (mehr Details, jünger).
- **Reihenfolge**: Phase 1 (Design-System-Grundlage) als erstes, weil sie den größten Hebel hat (Theme-Bug sofort sichtbar weg) und das Fundament für alle weiteren Schritte legt. Phase 2 vor Phase 3, weil die Komponenten-Extraktion Phase 3 überhaupt erst angenehm macht.
- **Solo + Side-Project**: Alle Trade-offs sind zugunsten von "pragmatisch und schnell" optimiert, nicht zugunsten von "ideal und vollständig". Wenn etwas weh tut, ist der einfachste Fix wahrscheinlich der richtige.
- **Mobile-First-Default ab jetzt**: Quick-Add im Supermarkt/Café ist der wichtigste Use-Case. Desktop ist die "Bonus"-Variante. Diese Priorität gilt für alle zukünftigen Features, nicht nur für diesen Refactor.
- **Rückwärtskompatibilität**: Die alten URLs (`/budgeting`, `/transactions`) redirecten per `definePageMeta` zu den neuen Sub-Routen. Browser-Verlauf und Bookmarks funktionieren weiter.
