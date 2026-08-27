# Forecast-Modus: Plan vs. Ist-Hochrechnung

Status: **accepted** (issue #60)

## Konzept

Wir berechnen pro Budget eine **Hochrechnung auf Monatsende** auf Basis des bisherigen Ausgaben-Tempos (`dailyRate`). Die Antwort auf die alltagsrelevante Frage "Wenn ich so weitermache, was bleibt am Monatsende übrig?" wird in zwei Zahlen geliefert:

- **`forecastTotal`** — was am Monatsende insgesamt ausgegeben sein wird (`spent + dailyRate × remainingDays`)
- **`forecastRemaining`** — was am Monatsende noch übrig ist (`planned - forecastTotal`)

Die Severity klassifiziert **`forecastTotal` vs. `planned`** (User-Spec aus Issue #60):
- **`on-track`** — `forecastTotal <= planned` (im Plan)
- **`warning`** — `forecastTotal in (planned, planned × 1.1]` (bis 10% über Plan)
- **`over`** — `forecastTotal > planned × 1.1` (mehr als 10% über Plan)

Auf dem Dashboard wird zusätzlich ein **aggregierter Forecast** im month-strip angezeigt: `sum(forecastTotal) vs. sum(planned)`, mit derselben Severity-Klassifikation.

## Berechnung

```
today             = new Date()                    // serverseitig, nicht client-side
monthStart        = getMonthWindow().monthStart   // bereits im Code
monthEnd          = getMonthWindow().monthEnd
daysSinceStart    = max(0, daysBetween(today, monthStart))   // bei today < monthStart: 0
daysRemaining     = max(0, daysBetween(monthEnd, today))     // bei today >= monthEnd: 0
dailyRate         = daysSinceStart > 0
                    ? spentAmount / daysSinceStart
                    : 0                                          // Edge case: Tag 1 des Monats
forecastTotal     = spentAmount + (dailyRate × daysRemaining)
forecastRemaining = plannedAmount - forecastTotal
```

**Warum serverseitig?** Issue #60 nennt das explizit: "Berechnung serverseitig (nicht client-side, weil Server den heutigen Tag kennt und dailyRate aus DB-History berechnet)". Vorteile:
- Konsistente Zeitzone (Server-Time, nicht User-Browser-Time)
- Konsistenter Snapshot bei mehreren Usern im selben Haushalt
- Kein Client-Code-Drift

**Daily-Rate-Modell.** Linear, kein gleitender Durchschnitt. Issue #60 nennt Linear als Default ("simpel und für die kurze Restzeit eines Monats OK"). Vorteile:
- Trivial zu erklären: "Was du bisher pro Tag ausgegeben hast, multipliziert mit den restlichen Tagen"
- Stabil bei kleinen Datenmengen (eine 250€-Woche hat nur 1-7 Transaktionen, gleitender Durchschnitt rauscht)
- Trivial zu testen

**Edge cases:**

| Situation | Verhalten |
|---|---|
| `today < monthStart` (sollte nie passieren, aber safety) | `daysSinceStart = 0`, `dailyRate = 0`, `forecastTotal = spentAmount` |
| `today == monthStart` (Tag 1) | `daysSinceStart = 0`, `dailyRate = 0`, `forecastTotal = spentAmount` (= was bisher ausgegeben) |
| `today == monthEnd - 1` (vorletzter Tag) | `forecastTotal ≈ spentAmount + dailyRate` |
| `today >= monthEnd` (Monat vorbei) | `daysRemaining = 0`, `forecastTotal = spentAmount` |
| `plannedAmount <= 0` | Division-by-zero-Schutz: `dailyRate` bleibt berechnet, aber `forecastSeverity = 'on-track'` (kein Plan = nichts zu verfehlen) |
| Transaktionen vor `monthStart` (sollten nicht in der DB sein) | Werden in `countPeriodsInMonth` rausgefiltert — kein Risiko |
| Aktuelle Woche geht über Monatsende (Mo 25.8. – So 31.8., Mo 1.9. – So 7.9. ist nächster Monat) | Forecast wird auf `monthEnd` gekappt, nicht in den nächsten Monat projiziert (passt zur bestehenden `month-strip`-Semantik: "aktueller Monat, nicht rollierend") |

## API-Shape

`GET /api/households/:householdId/budget-overview` liefert pro Budget zusätzlich:

```ts
{
  // bestehend (issue #82)
  budgetId, key, name, plannedAmount, spentAmount, remainingAmount,
  currentFrequency, periods,

  // NEU: Forecast
  forecastTotal: number,          // Cents, was am Monatsende ausgegeben sein wird
  forecastRemaining: number,      // Cents, was am Monatsende noch übrig ist
  forecastSeverity: 'on-track' | 'warning' | 'over',
  forecastBasisDays: number,      // Anzahl Tage, die in die dailyRate eingeflossen sind
  forecastBasisAmount: number,    // = spentAmount (für Transparenz)
  forecastComputedAt: string,     // ISO-Date, server-now, für UI ("Stand: 27.08. 14:37")
}
```

`buildBudgetAlerts()` reicht diese Felder an die Dashboard-Response durch, damit der month-strip darauf zugreifen kann.

## Frontend-UI

### Budget-Liste (Dashboard + Detail-Page)

Pro Budget-Zeile wird unter dem Monats-`meta`-Block ein Forecast-Block ergänzt:

```
KW 32 (4.–10. Aug)        [████████░░] 80%   warning
KW 33 (11.–17. Aug)       [██████████] 100%  over
...
[Voraussichtlich 285 € von 250 € geplant]  ← nur wenn currentFrequency != 'WEEKLY' ODER collapsed
```

**WEEKLY-Budgets:** Der Forecast wird im Toggle-Header gezeigt (Monats-Ebene), nicht in jeder einzelnen Woche. Wochen-Hochrechnung wäre Over-Engineering ("wenn du diese Woche so weitermachst, was ist am Wochenende" — beantwortet die Wochen-Liste selbst durch den Stand).

**Severity-Farbe:** Konsistent zur bestehenden Logik (`ListProgressBar.tone`):
- `on-track` → `ok` (grün)
- `warning` → `warning` (gelb)
- `over` → `over` (rot)

### Dashboard month-strip

Im `month-strip` wird eine vierte Zelle ergänzt: **"Voraussicht"** mit dem aggregierten Forecast:

```
Einnahmen | Ausgaben | Saldo | Voraussicht
2.500 €   | 1.800 €  | 700 € | -120 € über Plan   (severity: over)
```

Wenn `aggregat_forecastTotal <= sum_planned`: Severity = `on-track`, Anzeige "+X € im Plan" oder einfach ein grüner Tag.

**Variante** (entschieden 2026-08-27 mit User, Mockup in `/tmp/month-strip-forecast-mockup.html`): Variante 1 — 4. Zelle mit Label, Betrag und Severity-Tag. Strip wird 4-spaltig, Severity-Tag unter dem Betrag in der Zelle.

### Action-Required

**Bewusst NICHT aufgenommen** (entschieden 2026-08-27 mit User). Action-Required fokussiert sich auf den **Ist-Zustand** ("was muss ich mir JETZT ansehen"), nicht auf Vorschau. Forecast-„over"-Budgets sind nur in der Budget-Liste sichtbar, mit Severity-Tag. Begründung: Action-Required ist eine Handlungs-Aufforderung, Forecast ist eine Information — vermischen verwässert beide.

Falls der User später doch beides in Action-Required will, kann das nachgerüstet werden, ohne Datenmodell-Änderung.

## Considered Options

- **a) Persistierter Forecast** (`ForecastSnapshot`-Tabelle mit Monat/Haushalt/Budget/Betrag). Abgelehnt — Drift-Risiko (was, wenn nachträglich eine Transaktion editiert wird?), Forecast ist eine reine Funktion von `spentAmount` + `today` + `monthEnd`.

- **b) Gleitender 7-Tage-Durchschnitt** statt Linear. Verworfen — bei einer 250€/Woche-Budget hat der User 1-7 Transaktionen pro Woche, gleitender Durchschnitt rauscht. Linear ist für die Restzeit eines Monats genau genug.

- **c) Rollierender 30-Tage-Forecast** statt aktueller Monat. Verworfen — passt nicht zur bestehenden month-strip-Mechanik. Issue #60 nennt "Aktuell nur aktueller Monat" als explizite Wahl.

- **d) Forecast nur in der Budget-Liste, nicht im month-strip**. Verworfen — die Alltagsfrage "lande ich am Monatsende im Minus" ist eine aggregierte Frage, die der month-strip beantworten muss.

- **e) Wochen-basierter Forecast für WEEKLY-Budgets** ("wenn du diese Woche so weitermachst, was ist am Sonntag"). Verworfen — die Wochen-Liste aus #82 zeigt den aktuellen Wochen-Stand; ein Wochen-Forecast wäre redundant. Der Monats-Forecast auf dem Header reicht.

- **f) Schwellwerte >100% = over, >=80% = warning** (identisch zur Ist-Severity). Verworfen — Issue #60 nennt explizit `on-track / warning (bis +10%) / over (> +10%)`. Forecast-Schwellwerte sind semantisch anders: User will früh gewarnt werden, nicht erst bei 80% (weil Forecast auf dem bisherigen TEMPO basiert, das bereits kritisch sein kann).

- **g) Severity nur als `forecastRemaining >= 0 ? 'on-track' : 'over'`**. Verworfen — keine Abstufung. Issue #60 nennt explizit 3-stufige Severity.

- **h) Forecast-Formel mit `weeklyRate` für WEEKLY** (statt dailyRate). Verworfen — die Frage ist "Monatsende", nicht Wochenende. Daily linear über die Restmonatstage ist konsistent für alle Frequenzen.

- **i) Forecast OHNE jetzt, nur auf Tagesbasis zum Periodenende**. Verworfen — die User-Frage ist "wenn ich so weitermache", nicht "rein hypothetisch, ohne die heutigen Buchungen". `today` ist im Forecast, das ist gewollt.

## Consequences

- **Backend**: Neue Helper `buildForecast()` in `server/utils/budget-evaluation.ts` (oder neuer `server/utils/forecast.ts`). Pure function, gut testbar. Liefert pro Budget `forecastTotal`, `forecastRemaining`, `forecastSeverity`, `forecastBasisDays`, `forecastBasisAmount`, `forecastComputedAt`.

- **API-Propagation**: `BudgetOverviewItem` bekommt die Forecast-Felder. `buildBudgetAlerts()` reicht sie an die Dashboard-Response durch.

- **Tests**: 8-12 neue Tests in `budget-evaluation.test.ts` oder neuer `forecast.test.ts`:
  - Tag 1 des Monats → `daysSinceStart = 0`, `dailyRate = 0`, `forecastTotal = spentAmount`
  - Tag 15 des Monats, 50% verbraucht → `forecastTotal = planned`
  - Tag 28, alle Wochen-Budgets over
  - `today >= monthEnd` → `daysRemaining = 0`
  - `plannedAmount = 0` → `forecastSeverity = 'on-track'` (kein Plan zu verfehlen)
  - Severity-Schwellwerte: 0%, 80%, 100%, 110%, 150%
  - Aggregat: alle Budgets on-track → gesamt on-track; eines over → gesamt warning? (Severity-Aggregation: max severity wins)

- **Frontend**: `DashboardBudgetList` zeigt den Forecast-Block; `month-strip` bekommt eine 4. Zelle; `DashboardActionRequired` filtert zusätzlich nach `forecastSeverity === 'over'`.

- **Timezone**: Server-Time (UTC) als `today`. Wir akzeptieren, dass User in anderen Zeitzonen evtl. einen Tag "Versatz" sehen — das ist akzeptabel für Side-Project-Größenordnung. Dokumentiert in der ADR.

- **Performance**: `buildForecast()` ist O(1) pro Budget (kein DB-Zugriff, alles aus dem vorhandenen `BudgetOverview`-State ableitbar). Kein neues Query.
