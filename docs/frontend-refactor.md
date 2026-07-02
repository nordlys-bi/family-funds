# Frontend-Refactoring & Design-System

**Status:** Plan — Architektur-Entscheidungen getroffen, noch nicht umgesetzt
**Stand:** 2026-07-01 (Entscheidungen für Navigation, Confirm-Dialog, Dashboard-Daten **und Mobile-First** ergänzt)
**Scope:** `app/` (Nuxt 4 Frontend) + 1 neuer API-Endpoint für Dashboard-Summary
**Kontext:** Side-Project, Solo-Entwicklung. Pragmatisch, nicht über-engineered. **Mobile-First ab jetzt Default** (Quick-Add im Supermarkt/Café ist der wichtigste Use-Case).

## Architektur-Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Navigation für `budgeting` und `transactions` | **Sub-Routen** | Eigene URLs, sauberes Deep-Linking, klare 1:1-Verantwortung pro Seite. Tabs wären schneller, lösen aber das "zu viel auf einer Seite"-Problem nicht. |
| Bestätigungs-Dialoge | **Eigene `<ConfirmDialog>`-Komponente** | PrimeVue's `useConfirm()`-Composable ist Overkill für die 2 Use-Cases (Member entfernen, Einladung löschen). Eigene Lösung = weniger Konzepte, leichter zu stylen, kompatibel mit dem bestehenden Dark-Theme. |
| Dashboard-Daten | **Eigener API-Endpoint nötig** | Die existierenden Endpoints liefern Roh-Daten (Haushalt, Buchungen, Budget-Übersicht). Der Dashboard braucht eine **aggregierte Sicht** (Budget-Warnungen, letzte Buchungen, Sparziel-Progress), die explizit für den Startbildschirm kuratiert ist. |

---

## Ausgangslage

Das Frontend besteht aus 4 Hauptseiten + 1 Layout + 1 geteilter Listen-Komponente (`ListPageShell`). Die Pages sind fachlich vollständig (Haushalte, Planung, Buchungen), aber im UX- und Code-Zustand heterogen. Die Analyse hat zwei Kategorien von Problemen identifiziert:

1. **Strukturell** — zu viel Information pro Seite, vermischte Domänen, viel duplizierter Code.
2. **Design** — inkonsistente Komponenten, ein konkret sichtbarer Bug (weiße Selects in Modals), fünf handgeschriebene "Eyebrow"-Varianten.

---

## Befund

### Strukturelle Probleme

| Datei | Problem | Größe |
|---|---|---|
| `app/pages/index.vue` | Hardgecodete Mock-Statistiken (3.500 €, 1.250 € …) + Dev-Roadmap-Panel mit M3/M4/M5-Tags. Beides ist nicht user-facing. | 300 Z. |
| `app/pages/budgeting.vue` | **Vier fachlich getrennte Domänen** (Budgets, Einnahmen, Fixkosten, Sparziele) in einer Datei mit jeweils eigenem Modal. Insgesamt vier nahezu identische Form-Modal-Blöcke im Template (Z. 905–1165). Tote CSS-Klassen (Hero-Panel) im Block darunter. | 1.704 Z. |
| `app/pages/transactions.vue` | Einnahmen und Ausgaben in einer gemeinsamen Liste. Vier Summary-Tags, dann eine Liste, dann ein Modal. Keine Trennung der Buchungstypen, keine Filter. | 676 Z. |
| `app/pages/households.vue` | Summary-Block + 3 Detail-Karten + Member-Liste + Einladungs-Liste + 3 Modals. Strukturell am saubersten, aber: Member-Management und Haushalts-Settings sind konzeptionell getrennt und sitzen zusammen. | 825 Z. |

### Design-Inkonsistenzen

1. **Weiße Selects in Modals** — sichtbarstes Problem.
   - **Ursache:** Die globalen Styles in `app/app.vue:32-79` setzen `.p-select { background: rgba(8,15,30,0.96) }` als klassenbasierte Regel. PrimeVue 4 / Aura rendert Selects über CSS-Variablen (`--p-select-background`). Die Aura-Theme-Regel gewinnt per Kaskade. Innerhalb eines Dialogs wird `--p-select-background` unabhängig gesetzt.
   - **Fix:** Im PrimeVue-Theme-Config in `nuxt.config.ts` die semantischen Tokens (`--p-dialog-background`, `--p-select-background`, `--p-inputtext-background`) explizit auf die Dark-Variante setzen, alternativ per CSS die Variablen am Dialog-Root überschreiben.

2. **CSS-Duplikation** — größter Hebel für Wartbarkeit.
   - `.field`, `.field--wide`, `.dialog-actions`, `.dialog-form` → identisch in allen drei Pages.
   - `.list-panel` / `.plan-panel` / `.item-list` / `.item-card` / `.item-main` / `.item-title-row` / `.item-pill` / `.item-actions` / `.panel-head` / `.panel-kicker` / `.panel-badge` / `.empty-list` / `.empty-state` / `.empty-state__card` / `.toolbar-note` → überall mit leichten Variationen.
   - **Schätzung:** 60–70 % der CSS-Zeilen sind Copy-Paste mit Mini-Diffs.

3. **Fünf Eyebrow/Kicker-Varianten** für "Label oben in Caps":
   - `.panel-kicker` (0.72rem, #93c5fd) — `budgeting.vue`
   - `.list-panel__kicker` (0.75rem, #94a3b8) — `transactions.vue`, `households.vue`
   - `.list-page-shell__eyebrow` (0.78rem, #93c5fd) — `ListPageShell.vue`
   - `.empty-state__eyebrow` (0.76rem, #93c5fd) — alle Pages
   - `.toolbar-note__label` (0.85rem, #94a3b8) — alle Pages
   - **Fix:** Eine `<Kicker>`-Komponente, ein Style.

4. **Währungs-Input uneinheitlich.**
   - `transactions.vue` → `<InputNumber mode="currency" :currency="currencyCode" locale="de-DE">` (saubere DE-Formatierung)
   - `budgeting.vue` → `<InputText inputmode="decimal" placeholder="0,00">` (Nutzer tippt selbst mit Komma, Server parst)
   - **Fix:** Eine `<MoneyInput>`-Komponente, везде `InputNumber`.

5. **M3/M4/M5-Badges** in Sidebar (`app/layouts/default.vue:64,70,76`) und Page-Eyebrows (`pages/budgeting.vue:645`, `pages/transactions.vue:307`, `pages/households.vue:296`). Das sind Entwicklungsmarker, gehören nicht ins User-UI (zumindest nicht in der Form).

6. **Tag-Severities uneinheitlich** für gleiche Konzepte. Z. B. OWNER-Tag mal `success`, mal als Haupt-Akzent. "Aktiv"-Tag ist auch `success`. Schwer zu unterscheiden.

---

## Plan

### Phase 1 — Design-System-Grundlage
**Ziel:** Theme-Bug fixen, saubere Token-Schicht, eine Quelle der Wahrheit für visuelle Konstanten.

- [ ] **PrimeVue-Theme fixen** in `nuxt.config.ts`:
  - Semantische Tokens für `--p-dialog-background`, `--p-select-background`, `--p-inputtext-background` auf die Dark-Variante setzen.
  - Damit ist der weiße-Select-Bug strukturell weg.
- [ ] **Zentrale Tokens-Datei** `app/assets/css/tokens.css` mit CSS-Variablen für:
  - `--color-bg-panel`, `--color-bg-input`, `--color-bg-modal`
  - `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`
  - `--color-border-subtle`, `--color-border-strong`
  - `--color-accent-primary`, `--color-accent-success`, `--color-accent-warning`, `--color-accent-danger`
  - `--radius-sm`, `--radius-md`, `--radius-lg`
  - `--space-xs` bis `--space-xl`
- [ ] **Globales Stylesheet** in `app/assets/css/base.css` mit den häufigsten Basis-Styles (`.my-app-dark :where(.p-*)` Overrides, die jetzt in `app.vue` wild wachsen).
- [ ] **`<Kicker>`-Komponente** statt 5 handgeschriebener Varianten.
- [ ] **M3/M4/M5-Badges** aus Sidebar-Links und Page-Eyebrows entfernen.

**Ergebnis:** Modals sehen überall richtig aus. `app.vue` schrumpft von 80 Zeilen CSS auf 10 + saubere Tokens.

---

### Phase 2 — Komponenten extrahieren
**Ziel:** Den duplizierten Boilerplate in gemeinsame Komponenten heben.

- [ ] **`<ListPanel>`** — der wiederkehrende Block aus Header (Kicker, Titel, Badge, Toolbar) + Content. Ersetzt `.list-panel` / `.plan-panel`.
- [ ] **`<ItemCard>`** — die wiederkehrende Card für Listen-Einträge. Ersetzt `.item-card` in allen drei Pages.
- [ ] **`<EmptyState>`** — zentrale Variante mit Slot für CTA-Button.
- [ ] **`<FormDialog>`** + **`<FormField>`** — kümmern sich um Modal-Layout, Focus-Ring, Validation, korrektes PrimeVue-Dialog-Styling.
- [ ] **`<ConfirmDialog>`** — ersetzt die `window.confirm()`-Aufrufe in `households.vue:228, 254`.
- [ ] **`<MoneyInput>`** — `<InputNumber mode="currency" locale="de-DE">` везде.
- [ ] **`<RoleTag>` / `<StatusTag>`** — vereinheitlichte Tag-Verwendung für OWNER/MEMBER/Aktiv/etc.
- [ ] **`<NavSection>`** — hierarchische Sidebar-Section mit Header + eingerückten Children. Active-State-Logik: Section-Header highlighted wenn irgendeine Child-Route aktiv. Wird in `default.vue` für "Budgetierung" und "Transaktionen" verwendet.

**Ergebnis:** `budgeting.vue` schrumpft auf ~600 Zeilen, `transactions.vue` auf ~350, `households.vue` auf ~400. Alle Modals sehen identisch aus.

---

### Phase 3 — Pages umstrukturieren
**Ziel:** Eine Sache pro Seite, klare Informationshierarchie.

- [ ] **Neuer API-Endpoint** `GET /api/households/[householdId]/dashboard`:
  - Liefert aggregierte Sicht: Monats-Summary, Budget-Warnungen, letzte Buchungen, Sparziel-Progress.
  - Spec siehe [API-Skizze: Dashboard-Summary](#api-skizze-dashboard-summary) unten.
  - Auth: `requireHouseholdMembership` (analog zu `transactions.get.ts`).
  - Tests: `server/api/households/[householdId]/__tests__/dashboard.get.test.ts`.
- [ ] **Dashboard** (`pages/index.vue`) auf neuen Endpoint umstellen:
  - Mock-Daten weg.
  - Dev-Roadmap-Panel weg.
  - Fokus: aktiver Haushalt + 1–2 actionable Cards (z. B. "2 Budgets fast voll", "3 Ausgaben diese Woche").
- [ ] **Budgeting aufteilen** — Sub-Routen, alle unter Sidebar-Section "Budgetierung":
  - `/budgeting/budgets` — periodische Budgets
  - `/budgeting/recurring` — Einnahmen & Fixkosten (sind beides Pläne mit Frequenz)
  - `/budgeting/savings` — Sparziele
  - `/budgeting` (Hauptseite) → Redirect auf `/budgeting/budgets`.
- [ ] **Transactions aufteilen** — Sub-Routen:
  - `/transactions/expenses` — Ausgaben mit Filter (Budget, Zeitraum)
  - `/transactions/income` — Einnahmen
  - `/transactions` (Hauptseite) → Redirect auf `/transactions/expenses`.
- [ ] **Households**:
  - `/households` → Übersicht + aktiver Haushalt
  - `/households/members` → Mitglieder + Einladungen
  - `/households/settings` → Name + Currency ändern
- [ ] **Sidebar anpassen** — neue Sub-Routen bekommen eigene Einträge mit kleinen Indikatoren (z. B. Chevron oder Trennstrich), damit die Hierarchie sichtbar bleibt.

**Ergebnis:** Jede Seite hat genau eine Aufgabe. Scroll-Last sinkt deutlich. Modals werden deutlich weniger gleichzeitig sichtbar.

---

## Erfolgskriterien

- [ ] Kein weißes Select in einem Modal mehr (Phase 1)
- [ ] Keine CSS-Duplikate zwischen Pages (Phase 2)
- [ ] Maximal 1 Modal pro Seite sichtbar (Phase 3)
- [ ] Jede Page < 400 Zeilen (Phase 3)
- [ ] Alle Form-Inputs verwenden `<MoneyInput>` / `<FormField>` (Phase 2)
- [ ] Keine Mock-Daten im Production-UI (Phase 3)

---

## Empfohlene Reihenfolge

Wenn nur **eine** Sache heute: **Phase 1 komplett**. Das ist der größte Hebel — Theme-Bug ist sofort sichtbar weg, und alle weiteren Schritte bauen auf einem sauberen Fundament auf.

Phase 2 und 3 können in beliebiger Reihenfolge kommen, je nachdem was stärker nervt. Realistisch: Phase 2 zuerst (es macht Phase 3 überhaupt erst angenehm), dann Phase 3.

---

## Was bewusst NICHT Teil dieses Plans ist

- **Keine neuen Bibliotheken.** Das bestehende Setup (Nuxt 4 + Vue 3 + PrimeVue 4 + PrimeIcons) reicht. Kein Headless-UI, kein Tailwind, kein eigenes Design-System-Framework.
- **Keine TypeScript-Refactorings** jenseits dessen, was die Komponenten-Extraktion mit sich bringt.
- **Keine Performance-Optimierungen** (Code-Splitting, Lazy-Loading etc.) — kommen separat, wenn nötig.
- **Keine Storybook / visuelle Tests** — Side-Project, zu viel Overhead.

**Scope-Erweiterung:** Ein neuer Backend-Endpoint (`GET /api/households/[householdId]/dashboard`) ist Teil des Plans, weil das Dashboard echte aggregierte Daten braucht. Sonst keine Backend-Änderungen.

---

## Mobile-First (Pflicht ab jetzt)

**Warum:** Mindestens für die Dateneingabe ist Mobile das wichtigste Endgerät — am Supermarkt, im Café, unterwegs. Wer unterwegs nicht buchen kann, bucht nicht. Desktop ist die "Bonus"-Variante.

### Aktueller Zustand

- 5+ verschiedene Breakpoints (640, 720, 768, 980, 1100, 1120) in verschiedenen Dateien — keine einheitliche Strategie.
- 2-Spalten-Form-Grid wird zwar zu 1 Spalte kollabiert, aber Field-Labels rutschen unter die Mobile-Tastatur.
- Dialogs sind `min(42rem, 94vw)` → auf 360px-Display nur ~338px breit, Form-Inhalte gestaucht.
- Kein Quick-Add-Flow. Wer eine Ausgabe erfassen will, muss navigieren → Modal öffnen → eintippen. Auf Mobile zu viel friction.
- Sidebar ist `position: absolute` und nur ein-/ausgeblendet — kein echtes Drawer-Verhalten mit Backdrop, kein Swipe-to-Close.
- Touch-Targets (Sidebar-Nav-Items, Action-Buttons) sind oft < 36px hoch.

### Prinzipien

1. **Mobile-first Token-System.** Spacing/Sizing werden zuerst für 360px-Viewport entworfen. Desktop ist nur ein "mehr Platz"-Override.
2. **Touch-Targets ≥ 44 × 44pt.** Alle interaktiven Elemente — Buttons, Icon-Buttons, Tag-Pills, List-Items — haben eine Mindest-Klickfläche.
3. **Full-screen Modals auf Mobile** (< 640px). Bottom-Sheet oder Full-Screen-Dialog. Form-Inhalte in 1 Spalte.
4. **Numerische Tastatur für Geld.** `InputNumber` везде, prüfen dass `inputmode="decimal"` gesetzt ist (PrimeVue macht das bei `mode="currency"` AFAIK).
5. **Keine Hover-only-Interaktionen.** Hover-States sind Bonus, jede Aktion muss auch per Tap verfügbar sein.
6. **Eine Aufgabe pro Page** — passt zu den Sub-Routen. Mobile-User scrollt nicht gern.

### Quick-Add (Pflicht-Feature)

Der wichtigste Mobile-Flow: eine Ausgabe in unter 10 Sekunden erfassen.

- **Floating Action Button (FAB)** unten rechts auf Mobile, sichtbar auf allen Pages außer Login. Wird im `default.vue`-Layout platziert, nicht in den einzelnen Pages.
- **Tap auf FAB = öffnet Submenü** (Material "Speed-Dial"-Pattern). Es gibt **keinen** Direkt-Auslöser mehr — Sicherheit und Konsistenz vor 1-Tap-Optimierung.
- **Submenü = 3 Mini-FABs im Viertelkreis** oberhalb/rechts des Haupt-FAB:
  - **Ausgabe** (rot, `pi pi-arrow-up-right`)
  - **Einnahme** (grün, `pi pi-arrow-down-left`)
  - **Sparziel anlegen** (blau, `pi pi-star`)
  - *(3 Items im 90°-Bogen, jeder 56-64px vom Haupt-FAB entfernt. Nicht 4 — das wird zu eng im Viertelkreis. "Budget anlegen" rutscht ins normale Budgeting-UI, nicht in den Speed-Dial.)*
- **Animation:** Haupt-FAB-Icon rotiert 45° von "+" zu "×" beim Öffnen. Mini-FABs erscheinen mit Stagger (je 50ms verzögert) per `scale(0)` → `scale(1)` + `translate`. Tap außerhalb oder ESC schließt.
- **Labels:** erscheinen links vom jeweiligen Mini-FAB (right-aligned, da der FAB in der rechten Ecke sitzt). Nur sichtbar im "open"-State.
- **Implementierung:** `<FabSpeedDial>`-Komponente. **Kein** `useLongPress` mehr nötig — Speed-Dial ist die robustere, sichtbarere Variante.
- Tippen auf eine Mini-Action öffnet ein **Bottom-Sheet** (full-screen auf < 640px) mit Minimal-Form:
  - Typ (vorausgefüllt aus Speed-Dial-Auswahl)
  - Betrag — großer Touch-Bereich, numerische Tastatur
  - Budget (Select, nur für Ausgaben)
  - Beschreibung (optional, Textarea)
  - Datum (default heute, sheet-internal DatePicker)
  - "Speichern" — sticky am Bottom, full-width, hoher Button
- "N"-Desktop-Shortcut bleibt erhalten.
- **Desktop-Verhalten:** FAB ist auf Mobile-only. Auf Desktop bekommt der existierende "Neu"-Button im Toolbar den gleichen Split-Button-Treatment (Hauptklick = Ausgabe, Dropdown-Pfeil = die 3 gleichen Aktionen + "Budget anlegen"). Konsistente Aktionen, andere Metapher.

### Konkrete Mobile-Aufgaben pro Phase

**Phase 1 (zusätzlich):**
- [ ] Touch-Target-Größe als Token: `--touch-target-min: 2.75rem` (44pt).
- [ ] Breakpoint-Vereinheitlichung: nur 2 Breakpoints — `mobile: < 640px`, `desktop: ≥ 640px`. Alle existierenden 5+ Breakpoints raus.
- [ ] `tokens.css` mobile-first: Basis-Spacing für 360px-Viewport, Desktop-Overrides ab 640px.
- [ ] PrimeVue Dialog auf < 640px → full-width, full-height (Bottom-Sheet).

**Phase 2 (zusätzlich):**
- [ ] **`<FabSpeedDial>`-Komponente** — der runde Haupt-FAB (56×56px) plus die 3 Mini-FABs im Viertelkreis. Haupt-Icon rotiert beim Öffnen, Stagger-Animation für die Mini-FABs, Tap-outside/ESC schließt. Safe-Area-Insets für iPhone-Notch.
- [ ] **Speed-Dial Items:** 3 vordefinierte Actions (Ausgabe / Einnahme / Sparziel anlegen) als Props oder Slots, damit wir die Komponente ggf. kontextspezifisch einsetzen können.
- [ ] **FAB im `default.vue`-Layout** platzieren, nicht in den Pages. Auf Desktop via `@media (min-width: 640px) { display: none }` versteckt; dort übernimmt der Split-Button im Toolbar (`Neu`-Button mit Dropdown-Pfeil, gleiche 3 + 1 Actions).
- [ ] `<BottomSheet>`-Wrapper — kann PrimeVue Dialog mit `position: "bottom"` sein, gewrapped für unsere Stile.
- [ ] Alle `<Button>` default `min-height: var(--touch-target-min)`.
- [ ] Item-Card komplett tappbar (nicht nur die Action-Buttons — die ganze Card öffnet Edit, mit Action-Buttons als sichtbare Alternative daneben).

**Phase 3 (zusätzlich):**
- [ ] Echte Sidebar → Drawer: Off-Canvas mit Backdrop, ESC schließt, optional Swipe-to-Close (für Phase 2 oder später, nicht-blocking).
- [ ] Bottom-Nav auf Mobile mit 3–4 Hauptaktionen (Dashboard · Buchen · Planen · Haushalt). Optional, kann auch der FAB + Sidebar reichen.
- [ ] Dashboard auf Mobile: Stack-Cards statt Grid. Eine Insight pro Card, full-width.
- [ ] Form-Pages: Sticky-Header mit Titel + Schließen, Sticky-Footer mit Primäraktion. Scroll-Container dazwischen. Damit die Mobile-Tastatur den Submit-Button nicht verdeckt.
- [ ] Household-Switcher in der Sidebar lassen (auf Mobile über Drawer), nicht im Header (240px-Select passt nicht in einen Phone-Header).

### Was Mobile NICHT braucht (Side-Project-Scope)

- Keine PWA / Offline-Support
- Keine Push-Notifications
- Keine Kamera-Integration für Belege (kommt in `docs/CONTEXT.md` als "Zukünftige Erweiterung" — explizit nicht Teil dieses Plans)
- Kein haptisches Feedback
- Kein komplexes Swipe-Gesture-Handling (maximal Swipe-to-Close-Drawer)

---

## API-Skizze: Dashboard-Summary

**Endpoint:** `GET /api/households/[householdId]/dashboard`

**Auth:** `requireHouseholdMembership(event, householdId)` — gleiche Pattern wie `transactions.get.ts`.

**Response-Shape (Werte in Cent, `date` als ISO-String):**

```ts
{
  household: {
    id: string,
    name: string,
    currency: string,
  },

  month: {
    start: string,                  // ISO, Monatsbeginn
    end: string,                    // ISO, Monatsende (exklusiv)
    incomeTotal: number,            // Summe IncomeTransaction
    expenseTotal: number,           // Summe ExpenseTransaction
    netTotal: number,               // incomeTotal - expenseTotal
    unassignedExpenseTotal: number, // Ausgaben ohne Budget-Zuordnung
  },

  budgetAlerts: Array<{
    budgetId: string,
    name: string,
    planned: number,                // Soll (cents)
    spent: number,                  // Ist (cents)
    remaining: number,              // planned - spent
    percentUsed: number,            // 0..150, gerundet auf 1 Nachkommastelle
    severity: 'ok' | 'warning' | 'over', // <80% ok, 80-100% warning, >100% over
  }>,
  // Hinweis: nur Budgets mit severity != 'ok' ODER Top-3 nach percentUsed.
  // "Sonstiges" (unassigned) ist NICHT enthalten — das ist eine Catch-All-Kategorie, keine Warnung.

  recentActivity: Array<{
    id: string,
    kind: 'expense' | 'income',
    amount: number,
    description: string | null,
    date: string,                   // ISO
    budgetName: string | null,      // null für Einnahmen
    user: {
      id: string,
      displayName: string | null,
      email: string,
    },
  }>,
  // Letzte 7 Tage, max 5 Einträge, neueste zuerst.

  savingsGoalsProgress: Array<{
    goalId: string,
    name: string,
    targetAmount: number,
    currentAmount: number,          // Summe aller SavingsGoalExecution.amount
    monthlyRate: number,            // aus SavingsGoal.monthlyRate
    percentToTarget: number,        // 0..100+
  }>,
  // Alle aktiven Sparziele (endDate null oder in der Zukunft), sortiert nach percentToTarget desc.
}
```

**Implementierungs-Hinweise:**

- `getMonthWindow()` aus `server/utils/budget-evaluation.ts` wiederverwenden (für `month.start` / `month.end`).
- `buildBudgetOverview()` wiederverwenden — liefert bereits `plannedAmount`, `spentAmount`, `remainingAmount` pro Budget. Im Endpoint nur noch filtern + `percentUsed` + `severity` ableiten.
- `recentActivity` = `findMany` über Expense + Income mit `date: { gte: sevenDaysAgo, lt: month.end }`, gemischt, sortiert, limit 5. Geteilte Logik mit `transactions.get.ts` könnte man in `server/utils/transactions.ts` extrahieren — **aber nur wenn der Test-Impact das rechtfertigt**; sonst erstmal Copy-Paste, refactoren wenn wir es zum dritten Mal kopieren.
- `savingsGoalsProgress`: pro Goal `prisma.savingsGoalExecution.groupBy({ where: { goalId }, _sum: { amount: true } })` — das sind je 1 Query pro Goal. Bei vielen Goals optimieren (DataLoader o. ä.) — für den Anfang aber OK.

**Tests:**

- `server/api/households/[householdId]/__tests__/dashboard.get.test.ts` mit Cases:
  - Happy Path: 1 Household, 3 Budgets (1x ok, 1x warning, 1x over), 2 Ausgaben letzte Woche, 1 Sparziel.
  - Empty State: kein Budget, keine Buchungen, keine Sparziele → leere Arrays, `month.incomeTotal = 0`, etc.
  - Auth: anderer User → 403.
  - 7-Tage-Fenster: Buchung älter als 7 Tage taucht nicht in `recentActivity` auf.

---

## Offene Punkte (nach Entscheidungsrunde)

- [x] **Sidebar-Darstellung der Sub-Routen** — **ENTSCHIEDEN:** Hierarchisch. `<NavSection>`-Komponente mit eingerückten Children, Section-Header highlightet wenn eine Child-Route aktiv ist. Begründung: spiegelt die Domäne, skaliert, klarerer Active-State.
- [x] **Dashboard "Today's actions"-Logik** — **ENTSCHIEDEN:** Statisch. Keine User-Config, keine Settings-UI. Insights sind kuratiert (Budgets > 80 %, Top 3 Sparziele, letzte 5 Buchungen), Empty-States regeln den Rest. Kein Collapsible-Feature in V1.
- [x] **Migrationspfad `/budgeting` → `/budgeting/budgets`** — **ENTSCHIEDEN:** `definePageMeta({ redirect: '/budgeting/budgets' })` in `pages/budgeting.vue`. Selbe Pattern für `/transactions` → `/transactions/expenses`. Kein Server-Middleware, kein 301.
- [x] **FAB auf Desktop** — sichtbar oder versteckt? — **ENTSCHIEDEN:** FAB nur auf Mobile, Desktop-Toolbar bekommt Split-Button "Neu" mit den 3+1 gleichen Aktionen.
- [x] **Bottom-Nav ja oder nein** — **ENTSCHIEDEN:** Kein Bottom-Nav, FAB + Sidebar-Drawer reicht.
