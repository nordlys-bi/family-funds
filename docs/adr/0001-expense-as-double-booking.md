# Expense-Realaktionen als Doppelbuchung in `ExpenseTransaction` und `SavingsGoalExecution`

Status: accepted

Wir unterscheiden zwei unabhängige Buchungs-Ströme: tatsächliche Ausgaben (`ExpenseTransaction`) für Ausgaben-Reports und Topf-Bewegungen (`SavingsGoalExecution`) für den Stand eines `SavingsGoal`-Topfes. Wenn eine Real-Aktion aus einem Spar-Topf bezahlt wird (z.B. eine 180€-Reise aus dem "Urlaub"-Topf), erzeugt sie **beide** Buchungen — eine `ExpenseTransaction` (damit die Reise im Ausgaben-Reporting erscheint) und eine `SavingsGoalExecution` mit negativem Betrag (damit der Topf-Stand automatisch sinkt).

**Considered Options:**

- **a) Nur `ExpenseTransaction`, Topf-Stand manuell gepflegt.** Abgelehnt — manuelle Pflege ist die Fehlerquelle, die wir mit der App abschaffen wollten.
- **b) Nur negative `SavingsGoalExecution`, keine `ExpenseTransaction`.** Abgelehnt — die Reise erscheint dann nicht im monatlichen Ausgaben-Reporting.
- **c) Doppelbuchung (gewählt).** Saubere Trennung: jede Frage hat eine kanonische Quelle. Reporting-Quelle ist `ExpenseTransaction`, Topf-Stand-Quelle ist `SavingsGoalExecution`.

**Consequences:**

- `SavingsGoalExecution.amount` ist `signed`: positiv = Ansparung, negativ = Entnahme. Der bisherige Schema-Kommentar ("actually saved in this month/period") muss auf "positiv = Ansparen, negativ = Entnahme" geweitet werden.
- Leichte Redundanz: eine Reise erzeugt zwei DB-Einträge. Akzeptiert, weil die Redundanz die Fragen "Was haben wir ausgegeben?" und "Wie voll ist der Topf?" sauber entkoppelt.
- UI muss an der Buchungs-Maske klar machen, wann beide Buchungen erzeugt werden sollen (z.B. ein Toggle "aus Topf X bezahlt", der automatisch die zweite Buchung ableitet).
- Reports müssen klar zwischen Ausgaben und Topf-Bewegungen trennen, damit Doppelbuchungen nicht doppelt gezählt werden.