# Family Funds — Synthese der 3-Perspektiven-Reviews

**Datum:** 09.07.2026
**Inputs:** `.reviews/2026-07-09-ux.md`, `.reviews/2026-07-09-ui.md`, `.reviews/2026-07-09-backend.md`
**Rolle:** Product Owner — Entscheidung über Roadmap aus drei Spezialisten-Perspektiven

---

## TL;DR

Drei Reviewer mit klarer Domänentrennung haben **36 Findings** geliefert (12 pro Perspektive). Etwa ein Drittel davon hängt zusammen — der gemeinsame Nenner heißt **Dashboard-Refactor** (UX-P1-2, UX-P2-7, UI-P1-4, UI-P2-8 absorbieren sich gegenseitig) und **Login-Page-Fix** (UX-P1-3 + UI-P2-7).

**Drei Schnellgewinne** (≈ 2–3 h gesamt, alle vor Beta-Sharing):
1. A11y-Sweep (UI-1 + UI-2 + UI-3) — WCAG-Pflicht, betrifft die ganze App, sofort messbar.
2. Login-Page-Fix (UX-3 **-Bug + UI-7 Tailwind-Duplikation) — eine Datei, ein Aufwasch.
3. Dashboard-Migration auf Design-System (UI-4) — halber Tag, schließt 3 weitere Findings nebenbei.

**Vier harte P1** aus dem Backend (Cookie-Sicherheit, user.deleted, TOCTOU, SavingsGoalExecution-API) bilden die kritische Datenintegritäts-Linie für Beta-Phase 1.

**Parken / Phase 2:** Skalierungs-P2-Findings (Indizes, Aggregates, Pagination, current.get-Split), die großen Architektur-Refactorings (DELETE-Split, Envelope-Konsistenz), und die UX-Features (FAB-Quick-Add, Bottom-Nav #14, Empty-States #13, Onboarding-Tour #16).

---

## Die Reviews im Quervergleich

### Überschneidungen & Resonanzen

Drei thematische Cluster tauchen in mehreren Perspektiven auf — das ist kein Zufall, das ist eine Systemschwäche:

**Cluster A: Dashboard**
- UX-P1-2: FAB verdeckt Touch-Targets am Listenende (Mobile-Pain)
- UX-P2-7: "Aktiv"-Tag tautologisch (Dashboard-Banner)
- UI-P1-4: Dashboard außerhalb des Design-Systems (Skalierungs-Blocker)
- UI-P2-8: Drei Big-Card-Styles identisch (Kontext-Banner ist eine davon)

→ **Ein Dashboard-Refactor löst 4 Findings gleichzeitig.** UX-P2-7 fällt weg (Banner durch `ListPanel` ersetzt), UX-P1-2 fällt weg (ItemCard-Aktionen bekommen FAB-Reserve), UI-P1-4 ist der Refactor selbst, UI-P2-8 fällt zu großen Teilen mit.

**Cluster B: Login-Page**
- UX-P1-3: `**Mock-Modus**` rendert literal mit Sternchen
- UI-P2-7: `login.vue` dupliziert `ClerkLoginCard` + rollt eigenes Tailwind-Utility-Set

→ **Beide Fixes am gleichen File.** UX-3 ist 30 Sekunden (String-Tausch), UI-7 ist ein strukturelles Refactoring (~ 2 h). Beides gehört in einen Aufwasch.

**Cluster C: Touch-Targets & Mobile-A11y**
- UX-P1-2: FAB verdeckt Touch-Targets
- UI-P1-1: Icon-Buttons ohne aria-label (> 30 Stellen)
- UI-P1-3: Sidebar/Header ohne sichtbare Fokus-States
- UI-P1-2: prefers-reduced-motion fehlt komplett

→ **A11y-Sweep bündelt vier P1-Findings** in 2–3 h. Alle vier sind WCAG-Verletzungen, alle vier sehen für Tester wie „die App fühlt sich nicht polish an" aus.

### Wo sich die Perspektiven widersprechen oder spannen

Kaum. Die Reviewer haben sauber getrennt. Einzige Reibungs-Stelle:

**Dashboard-Refactor (UI-P1-4) vs. Beta-Time-Box.** UI-Reviewer sagt „halber Tag, muss vor Beta". UX-Reviewer hat zwei konkrete P1-Findings am Dashboard, die der Refactor absorbiert. Backend-Reviewer ist nicht betroffen — die `/api/households/[id]/dashboard`-Aggregation ist explizit gelobt. **Konsens: Dashboard-Migration vor Beta-Phase 1.**

### Was die Perspektive ergänzt, was die andere blind wäre

- **UX allein** hätte den Cookie-Bug nie gesehen (Mock-Auth-Forge ist Backend).
- **Backend allein** hätte den Dashboard-Wildwuchs nie gesehen (das ist Code-Style auf der UI-Seite).
- **UI allein** hätte den TOCTOU-Bug nie gesehen (das ist Concurrency auf der Datenbank).
- **UX allein** hätte das fehlende Composite-Index-Risiko nie gesehen (Skalierung ist unsichtbar bis die ersten 1000 Transaktionen da sind).

→ **Alle drei Perspektiven sind nötig.** Keine kann die andere ersetzen.

---

## Empfohlene Roadmap (Product-Owner-Entscheidung)

### Phase 0 — Sofort (≤ 1 Sitzung, 2–3 h, vor allem anderen)

**Quick-Wins, die kein Architektur-Risiko haben und Tester sofort sehen:**

| Finding | Quelle | Aufwand |
|---|---|---|
| UX-3 `**Mock-Modus**` → `<strong>` | UX-P1-3 | 30 s |
| UX-5 UUID-Slice-Tag `9bff8d9f…` raus | UX-P2-5 | 1 min |
| UX-7 Dashboard "Aktiv"-Tag tautologisch raus | UX-P2-7 | 1 min |
| UX-11 Empty-Banner "wähle oben" responsiv | UX-P3-11 | 5 min |
| UX-12 `roleLabel()`-Helper für Owner/Member | UX-P3-12 | 15 min |
| UI-1 aria-labels auf Icon-Buttons (~ 30 Stellen) | UI-P1-1 | 30 min |
| Backend-4 TOCTOU → `upsert` statt `create` | Backend-P1-4 | 15 min |
| Backend-12 UUID-Validierung + Error-Handler (Basis) | Backend-P3-12 | 1 h |

**Begründung:** UX-3/5/7/11/12 sind offensichtliche Dev-Marker-Leaks (gleiche Kategorie wie die gefixten MEILENSTEIN-Eyebrows und Sandbox-Badge — direkt aus dem alten Report-Lesson-Learned). UI-1 ist WCAG-Pflicht und trivial. Backend-4 ist ein 5-Zeilen-`upsert`-Tausch. Backend-12 (UUID-Validation) ist die Basis für sichere Path-Params in allen späteren Refactorings.

**Verzichtet in Phase 0:**
- UX-P1-1 FAB Quick-Add — **geparkt**, Begründung unten
- UX-P1-2 FAB verdeckt Touch-Targets — **in Phase 1** verschoben, weil der Dashboard-Refactor (Phase 1) das Mobile-Layout neu denkt und ein isolierter Fix vor dem Refactor verschwendete Arbeit wäre

### Phase 1 — Beta-Phase-1-Vorbereitung (~ 3–4 Tage, vor Beta-Sharing)

**Architektur-arbeitende Fixes mit Feature-Wert:**

| Finding | Quelle | Aufwand | Was es bringt |
|---|---|---|---|
| UI-3 `:focus-visible` global | UI-P1-3 | 30 min | Tastatur-Navigation sichtbar |
| UI-2 `prefers-reduced-motion` global | UI-P1-2 | 1 h | WCAG 2.3.3, ~ 5–10 % der User |
| UI-4 Dashboard auf Design-System migrieren | UI-P1-4 | ½ Tag | absorbiert UX-P1-2, UX-P2-7, UI-P2-8 |
| UI-7 Login-Page aufräumen (Card-Wiederverwendung, kein Tailwind) | UI-P2-7 | 2 h | absorbiert UX-P1-3 |
| UI-6 Token-System im Layout konsequent | UI-P2-6 | 1–2 h | Vorbereitung für späteren Light-Mode |
| UI-9 `EmptyState` mit Spinner-Variante | UI-P2-9 | 1 h | konsistente Ladezustände |
| Backend-1 HMAC-signierter Session-Cookie | Backend-P1-1 | 1–2 h | Mock-Auth-Bypass geschlossen |
| Backend-2 `user.deleted`-Webhook implementieren | Backend-P1-2 | 1 h | DSGVO Art. 17 |
| Backend-3 `SavingsGoalExecution`-API (POST/PATCH/DELETE/GET) | Backend-P1-3 | ½ Tag | Domain-Modell komplett, Fundament für #12 |

**Phase-1-Bundle-Logik:** Die A11y-Fixes (UI-2 + UI-3) sind WCAG-Pflicht. Dashboard + Login sind die zwei meistbesuchten Pages der App. Die Backend-P1-Triologie (Cookie / Webhook / Savings-API) ist die kritische Datenintegritäts-Linie — diese drei *müssen* vor dem ersten echten Tester sein, sonst leakt der Mock-Mode auf Vercel-Preview-Deploys und der User-deleted-Webhook ist eine DSGVO-Zeitbombe.

**Bewusste Entscheidungen in Phase 1:**
- UX-P1-1 (FAB Quick-Add) **geparkt** — der Workaround „2 Klicks" funktioniert, der Architektur-Aufwand (Query-Param-Signaling oder Teleport-Dialog) lohnt erst, wenn Mobile-Power-User-Bedarf in Beta-Feedback kommt. Issue-Tracker-Eintrag als #17.
- UX-P1-2 (FAB verdeckt Targets) **in Phase 1 verschoben** — fällt beim Dashboard-Refactor mit ab, kein isolierter Fix.
- UX-P2-6 (MEMBER-Erklärung Einladen-Button) — trivial (1 Message-Block), kann in Phase 1 mitlaufen.

### Phase 2 — Beta-Phase-2 nach Tester-Feedback (~ 3–5 Tage)

**Skalierung und Architektur:**

| Finding | Quelle | Aufwand |
|---|---|---|
| Backend-5 Composite-Indizes `(householdId, date DESC)` | Backend-P2-5 | 30 min (Migration) |
| Backend-6 `_sum`/`groupBy` statt App-Layer-Aggregation | Backend-P2-6 | 1–2 h |
| Backend-7 Pagination auf `GET .../transactions` | Backend-P2-7 | ½ Tag |
| Backend-8 `requireHouseholdMembership` reduzieren auf `{ id: true }` | Backend-P2-8 | 15 min |
| Backend-9 `/api/households/current` splitten in fokussierte Endpoints | Backend-P2-9 | 1 Tag |
| UX-Features (Bottom-Nav #14, Empty-States #13, Onboarding-Tour #16) | UX-Roadmap | ~ 3 Tage |
| UX-#12 Savings-Progress (braucht Backend-3 aus Phase 1) | UX-Roadmap | ½ Tag |
| UI-5 ItemCard-Erweiterung mit zentralisiertem Row-Style | UI-P2-5 | ½ Tag |
| UI-8 HeroCard-Komponente extrahieren | UI-P2-8 | ½ Tag |

**Phase-2-Logik:** Backend-P2-Findings treffen erst, wenn die Datenvolumen wachsen. 1k Transaktionen pro Haushalt sind in Beta-Phase 1 unrealistisch (5-Personen-Haushalt, 30 Buchungen/Tag = ~ 900/Monat, also erst nach 2–3 Monaten). Lieber Zeit in UX-Features investieren, die Tester sehen.

### Phase 3 — Tech-Debt-Backlog (nach Beta-Phase 2, vor V1.0)

| Finding | Quelle | Aufwand |
|---|---|---|
| Backend-10 DELETE-Endpoints splitten | Backend-P3-10 | 1 Tag |
| Backend-11 Envelope-Konsistenz + Planning-DRY | Backend-P3-11 | 1 Tag |
| Backend-9 Folge-Arbeit: OpenAPI-Spec | Backend-P2-9 Folge | 1 Tag |
| UX-P3 (Recurring 4× Neu, Member-Tile-Anchor, Owner/Member-Mikro) | UX-P3 | 1–2 h gesamt |
| UI-P3 (Tag-Wrapper, Kicker-Töne, Loading-Varianten) | UI-P3 | 2–3 h gesamt |

**Phase-3-Logik:** Reine API-Architektur-Refactorings, die für Beta-User unsichtbar sind. Erst sinnvoll, wenn API-Konsumenten (Mobile-App laut CONTEXT.md-Erweiterungsmöglichkeiten, CSV-Import, Bankdaten-Import) tatsächlich kommen.

---

## Was bewusst NICHT in die Roadmap kommt

**UX-P1-1 (FAB Quick-Add-Dialog)** — Der häufigste Mobile-Use-Case, aber:
- Der Workaround „FAB → Sub-Page → Create-Button → Dialog" funktioniert, ist nur 1 Klick mehr.
- Echte Architektur-Entscheidung: Query-Param-Signaling pro Page vs. globaler Teleport-Dialog mit eigener Form-Validation, Mobile-Keyboard-Handling, Success-Toast, Error-Rollback. Beide Wege sind je 1+ Tag.
- Bottom-Nav (#14, Phase 2) wird das eh umgestalten — FAB ist dann vielleicht obsolet oder durch eine andere Geste ersetzt.
- **Entscheidung:** Parken, als Issue #17 tracken, nach Bottom-Nav-Implementierung neu bewerten.

**UI-P3-10 (SummaryTag-Wrapper)** — Mikro-Polish, der nur eine Mini-Inkonsistenz glättet. Nicht funktional.

**UI-P3-12 (Skeleton/Spinner/Text Loading-States)** — Wird durch UI-P2-9 (`EmptyState`-Spinner-Erweiterung in Phase 1) zu großen Teilen gelöst. Restpolitur in Phase 3.

---

## Konsens-Check: Wo die drei Reviewer einer Meinung sind

Alle drei Reviewer sind explizit für:
- **WCAG-/A11y-Pflichten** vor Beta (UI-1, UI-2, UI-3 — alle P1).
- **Cookie/Webhook-Hardening** vor Production-Switch (Backend-1, Backend-2 — beide P1).
- **Domain-Modell-Komplettierung** (Backend-3 SavingsGoalExecution — explizit als „im CONTEXT.md definiert, im UI nicht ausführbar").
- **Architektur-Discipline** (UI-4 Dashboard-Refactor, UI-7 Login-Refactor, Backend-9 Endpoint-Split — alle drei unabhängig).

**Konsens-Stärke:** hoch. Es gibt keinen Target-Konflikt zwischen den Reviewern. Die einzige Spannung ist UX-P1-1 (FAB-Quick-Add) — und die ist eine Produkt-Frage, nicht eine Reviewer-Meinungs-Verschiedenheit.

---

## Was als Nächstes passiert

1. **User-Approval dieser Roadmap** (dich, jetzt).
2. Phase 0 — die ~ 1-h-Quick-Wins — würde ich heute noch in einer separaten Session durchziehen.
3. Phase 1 — Dashboard-Migration + A11y-Sweep + Backend-P1-Triologie — als nächste Iteration, ~ 3–4 Tage.
4. Phase 2 / 3 — nach Beta-Phase-1-Feedback entscheiden, nicht vorher.

**Offene Fragen an dich (Product-Owner-Pflicht):**
- Parken UX-P1-1 (FAB Quick-Add) wirklich? Mein Bauchgefühl: ja. Du?
- Phase 1 mit oder ohne UX-P1-2 (FAB-Touch-Targets) als isoliertem Pre-Fix vor Dashboard-Refactor? Mein Bauchgefühl: ohne, der Refactor absorbiert das.
- Phase 1 vor Beta-Sharing — was ist dein Beta-Sharing-Datum? Danach richtet sich, ob 3–4 Tage realistisch sind.