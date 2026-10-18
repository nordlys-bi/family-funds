/*
 * Demo-Daten fuer lokale Entwicklung: legt den Haushalt "Familie Demo" mit
 * knapp drei Monaten plausibler Buchungen an (Ende Juli bis heute).
 *
 * Anders als prisma/seed.ts loescht dieses Skript NICHT die ganze DB, sondern
 * nur einen bestehenden Haushalt gleichen Namens (Cascade) — beliebig oft
 * ausfuehrbar, andere lokale Testdaten bleiben erhalten. Nutzt die
 * Mock-User Jan/Sarah (legt sie an, falls sie fehlen).
 *
 *   npm run db:seed:demo
 *
 * Zufallswerte kommen aus einem festen Seed, damit zwei Laeufe am selben Tag
 * dieselben Daten erzeugen. Bildet ADR-0004 ab: Wochen- und Monatsbudgets mit
 * fortlaufendem Saldo, eine Betragsaenderung, ein in ein Monatsbudget
 * geschlossenes Wochenbudget (Frequenzwechsel), Umbuchungen Budget <-> Spartopf
 * und eine Doppelbuchung nach ADR-0001 (Urlaub aus dem Spartopf bezahlt).
 */
import { PrismaClient, Role, type Frequency } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()
const HOUSEHOLD_NAME = 'Familie Demo'

// --- Hilfen ---------------------------------------------------------------

// Mulberry32: kleiner deterministischer PRNG.
function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = createRandom(20260718)
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!
/** Betrag in Cent zwischen min und max Euro. */
const euros = (min: number, max: number) => Math.round((min + random() * (max - min)) * 100)

// Wie parseDateInput auf dem Server: lokaler Tag, 12:00 Uhr.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)
const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
const today = (() => {
  const now = new Date()
  return day(now.getFullYear(), now.getMonth() + 1, now.getDate())
})()
const isPast = (date: Date) => date <= today

const START_WEEK = day(2026, 7, 27) // Montag
const START_MONTH = day(2026, 8, 1)
const MONTHS: Array<[number, number]> = [[2026, 8], [2026, 9], [2026, 10]]

async function main() {
  const existing = await prisma.household.findMany({ where: { name: HOUSEHOLD_NAME }, select: { id: true } })
  if (existing.length > 0) {
    // Budgets mit Uebertrags-Verweis zuerst entkoppeln (onDelete: NoAction).
    await prisma.budget.updateMany({
      where: { householdId: { in: existing.map((h) => h.id) } },
      data: { carryoverToBudgetId: null },
    })
    await prisma.household.deleteMany({ where: { id: { in: existing.map((h) => h.id) } } })
    console.log(`Bestehenden Haushalt "${HOUSEHOLD_NAME}" entfernt.`)
  }

  const jan = await prisma.user.upsert({
    where: { oidcSubject: 'mock_user_jan' },
    update: {},
    create: { oidcSubject: 'mock_user_jan', email: 'jan@example.com', displayName: 'Jan' },
  })
  const sarah = await prisma.user.upsert({
    where: { oidcSubject: 'mock_user_sarah' },
    update: {},
    create: { oidcSubject: 'mock_user_sarah', email: 'sarah@example.com', displayName: 'Sarah' },
  })
  const someone = () => (random() < 0.55 ? sarah.id : jan.id)

  const household = await prisma.household.create({
    data: {
      name: HOUSEHOLD_NAME,
      currency: 'EUR',
      members: {
        create: [
          { userId: jan.id, role: Role.OWNER },
          { userId: sarah.id, role: Role.MEMBER },
        ],
      },
    },
  })
  const householdId = household.id

  // --- Budgets ------------------------------------------------------------

  async function createBudget(
    name: string,
    frequency: Frequency,
    balanceSince: Date,
    versions: Array<[Date, number]>,
  ) {
    return prisma.budget.create({
      data: {
        householdId,
        key: `budget_${randomUUID().replace(/-/g, '')}`,
        name,
        frequency,
        balanceSince,
        versions: { create: versions.map(([validFrom, amount]) => ({ validFrom, amount: amount * 100 })) },
      },
    })
  }

  // Lebensmittel: 220 €/Woche, ab September 240 € (Betragsaenderung).
  const groceries = await createBudget('Lebensmittel', 'WEEKLY', START_WEEK, [
    [START_WEEK, 220],
    [day(2026, 9, 7), 240],
  ])
  const drugstore = await createBudget('Drogerie', 'MONTHLY', START_MONTH, [[START_MONTH, 60]])
  const kids = await createBudget('Kinder', 'MONTHLY', START_MONTH, [[START_MONTH, 150]])
  const leisure = await createBudget('Freizeit & Ausgehen', 'MONTHLY', START_MONTH, [[START_MONTH, 120]])
  const gifts = await createBudget('Geschenke', 'MONTHLY', START_MONTH, [[START_MONTH, 50]])
  // Frequenzwechsel (ADR-0004): "Tanken" lief woechentlich und wurde zum
  // 31.08. in das neue Monatsbudget "Mobilität" geschlossen.
  const fuelWeekly = await createBudget('Tanken (wöchentlich)', 'WEEKLY', START_WEEK, [[START_WEEK, 45]])
  const mobility = await createBudget('Mobilität', 'MONTHLY', day(2026, 9, 1), [[day(2026, 9, 1), 190]])
  await prisma.budget.update({
    where: { id: fuelWeekly.id },
    data: { closedAt: day(2026, 8, 31), carryoverToBudgetId: mobility.id },
  })

  // --- Plaene: Fixkosten und Einnahmen ------------------------------------

  type PlanSpec = { name: string; amount: number; frequency: Frequency; dayOfMonth: number; months?: number[]; budgetId?: string }
  const fixedCostSpecs: PlanSpec[] = [
    { name: 'Miete', amount: 1250, frequency: 'MONTHLY', dayOfMonth: 1 },
    { name: 'Strom (Abschlag)', amount: 85, frequency: 'MONTHLY', dayOfMonth: 5 },
    { name: 'Internet', amount: 39.99, frequency: 'MONTHLY', dayOfMonth: 8 },
    { name: 'Handyverträge', amount: 29.98, frequency: 'MONTHLY', dayOfMonth: 15 },
    { name: 'Kita-Beitrag', amount: 210, frequency: 'MONTHLY', dayOfMonth: 3 },
    { name: 'Deutschlandticket', amount: 58, frequency: 'MONTHLY', dayOfMonth: 1 },
    { name: 'Streaming', amount: 13.99, frequency: 'MONTHLY', dayOfMonth: 20, budgetId: leisure.id },
    { name: 'Rundfunkbeitrag', amount: 55.08, frequency: 'QUARTERLY', dayOfMonth: 15, months: [7, 10] },
    { name: 'Kfz-Versicherung', amount: 142.3, frequency: 'QUARTERLY', dayOfMonth: 1, months: [7, 10] },
    { name: 'Privathaftpflicht', amount: 74.9, frequency: 'YEARLY', dayOfMonth: 12, months: [9] },
  ]
  const incomeSpecs: PlanSpec[] = [
    { name: 'Gehalt Jan', amount: 3240, frequency: 'MONTHLY', dayOfMonth: 28 },
    { name: 'Gehalt Sarah (Teilzeit)', amount: 1860, frequency: 'MONTHLY', dayOfMonth: 30 },
    { name: 'Kindergeld', amount: 510, frequency: 'MONTHLY', dayOfMonth: 10 },
  ]
  // Plan-Start passend zum Raster (QUARTERLY/YEARLY: Monat des Startdatums zaehlt).
  const planStart = (spec: PlanSpec) => day(2026, spec.months?.[0] ?? 7, 1)

  for (const spec of fixedCostSpecs) {
    const plan = await prisma.fixedCostPlan.create({
      data: {
        householdId,
        name: spec.name,
        amount: Math.round(spec.amount * 100),
        frequency: spec.frequency,
        startDate: planStart(spec),
        budgetId: spec.budgetId ?? null,
      },
    })
    for (const [y, m] of [[2026, 7] as [number, number], ...MONTHS]) {
      if (spec.months && !spec.months.includes(m)) continue
      const date = day(y, m, spec.dayOfMonth)
      if (date < day(2026, 7, 20) || !isPast(date)) continue
      await prisma.expenseTransaction.create({
        data: {
          householdId,
          userId: jan.id,
          amount: plan.amount,
          description: spec.name,
          date,
          fixedCostPlanId: plan.id,
          budgetId: spec.budgetId ?? null,
        },
      })
    }
  }

  for (const spec of incomeSpecs) {
    const plan = await prisma.incomePlan.create({
      data: {
        householdId,
        name: spec.name,
        amount: Math.round(spec.amount * 100),
        frequency: spec.frequency,
        startDate: planStart(spec),
      },
    })
    for (const [y, m] of [[2026, 7] as [number, number], ...MONTHS]) {
      const date = day(y, m, spec.dayOfMonth)
      if (date < day(2026, 7, 20) || !isPast(date)) continue
      await prisma.incomeTransaction.create({
        data: {
          householdId,
          userId: spec.name.includes('Sarah') ? sarah.id : jan.id,
          amount: plan.amount,
          description: spec.name,
          date,
          incomePlanId: plan.id,
        },
      })
    }
  }
  await prisma.incomeTransaction.create({
    data: {
      householdId,
      userId: sarah.id,
      amount: 6000,
      description: 'Kinderfahrrad verkauft (Kleinanzeigen)',
      date: day(2026, 9, 21),
    },
  })

  // --- Alltagsausgaben ----------------------------------------------------

  type Expense = { budgetId: string | null; amount: number; description: string; date: Date }
  const expenses: Expense[] = []
  const add = (budgetId: string | null, amount: number, description: string, date: Date) => {
    if (isPast(date)) expenses.push({ budgetId, amount, description, date })
  }

  // Lebensmittel: Wocheneinkauf + 2–3 kleinere Einkaeufe + Baecker.
  // Einzelne Wochen laufen ueber (Grillfest, Besuch), damit der Saldo
  // sichtbar schwankt und auch mal ins Minus geht.
  for (let week = START_WEEK, index = 0; isPast(week); week = addDays(week, 7), index++) {
    const heavy = index === 2 || index === 6 || index === 10
    add(groceries.id, euros(100, 135) + (heavy ? euros(40, 70) : 0), pick(['Edeka', 'Rewe']), addDays(week, 5))
    add(groceries.id, euros(35, 55), pick(['Aldi', 'Lidl']), addDays(week, 1))
    add(groceries.id, euros(20, 40), pick(['Lidl', 'Aldi', 'Netto']), addDays(week, 3))
    if (random() < 0.6) add(groceries.id, euros(10, 25), pick(['Wochenmarkt', 'Rewe']), addDays(week, 4))
    add(groceries.id, euros(8, 14), pick(['Bäckerei Schulz', 'Bäcker']), addDays(week, 6))
    if (heavy) add(groceries.id, euros(25, 40), index === 6 ? 'Getränke Grillfest' : 'Getränkemarkt', addDays(week, 4))
  }

  // Tanken woechentlich bis zum Stichtag, danach monatlich als "Mobilität".
  for (let week = START_WEEK; week < day(2026, 8, 31); week = addDays(week, 7)) {
    add(fuelWeekly.id, euros(38, 55), pick(['Aral', 'Shell', 'Jet']), addDays(week, 2))
  }
  for (const [y, m] of MONTHS) {
    if (m >= 9) {
      add(mobility.id, euros(55, 68), pick(['Aral', 'Shell', 'Jet']), day(y, m, 4))
      add(mobility.id, euros(52, 66), pick(['Aral', 'Shell', 'Jet']), day(y, m, 17))
      add(mobility.id, euros(3, 6), 'Parkhaus Innenstadt', day(y, m, 12))
      if (m === 9) add(mobility.id, 8990, 'Inspektion Fahrrad', day(y, m, 23))
    }

    add(drugstore.id, euros(22, 34), pick(['dm', 'Rossmann']), day(y, m, 6))
    add(drugstore.id, euros(12, 26), pick(['dm', 'Rossmann']), day(y, m, 19))

    add(kids.id, euros(25, 45), pick(['Schwimmkurs', 'Turnverein']), day(y, m, 2))
    add(kids.id, euros(18, 40), pick(['Kinderkleidung C&A', 'Schuhe Deichmann']), day(y, m, 14))
    if (m === 8) add(kids.id, 7450, 'Schulranzen & Schulbedarf', day(y, m, 25))
    if (m === 9) add(kids.id, 2400, 'Kita-Ausflug Zoo', day(y, m, 18))
    if (m === 10) add(kids.id, euros(15, 25), 'Bastelbedarf Herbst', day(y, m, 9))

    add(leisure.id, euros(28, 55), pick(['Pizzeria Da Mario', 'Thai Imbiss', 'Biergarten']), day(y, m, 9))
    add(leisure.id, euros(20, 32), pick(['Kino', 'Freibad', 'Minigolf']), day(y, m, 16))
    if (random() < 0.7) add(leisure.id, euros(8, 15), 'Eisdiele', day(y, m, 22))

    // Geschenke: nicht jeden Monat — der Saldo waechst und wird im Oktober
    // teilweise in den Urlaubstopf umgebucht.
    if (m === 8) add(gifts.id, 3500, 'Geburtstag Oma', day(y, m, 11))
    if (m === 10) add(gifts.id, 2290, 'Kindergeburtstag Lea', day(y, m, 8))

    // Ohne Budget ("Sonstiges")
    add(null, euros(9, 25), pick(['Apotheke', 'Post / Paket', 'Schlüsseldienst Ersatzschlüssel']), day(y, m, 13))
  }
  add(null, 48000, 'Ferienwohnung Ostsee (aus Spartopf)', day(2026, 10, 3))

  for (const expense of expenses) {
    await prisma.expenseTransaction.create({
      data: { householdId, userId: someone(), ...expense },
    })
  }
  // Eine geloeschte Buchung, damit "Wiederherstellen" etwas zu zeigen hat.
  await prisma.expenseTransaction.create({
    data: {
      householdId,
      userId: sarah.id,
      budgetId: groceries.id,
      amount: 1999,
      description: 'Doppelt erfasst',
      date: day(2026, 10, 6),
      deletedAt: day(2026, 10, 6),
    },
  })

  // --- Spartoepfe -----------------------------------------------------------

  async function createGoal(name: string, target: number, rate: number) {
    return prisma.savingsGoal.create({
      data: { householdId, name, targetAmount: target * 100, monthlyRate: rate * 100, startDate: day(2026, 7, 1) },
    })
  }
  const vacation = await createGoal('Urlaub', 2500, 150)
  const emergency = await createGoal('Notgroschen', 5000, 200)
  const car = await createGoal('Auto-Reparatur', 1500, 75)

  const executions: Array<{ savingsGoalId: string; amount: number; date: Date; note?: string; sourceBudgetId?: string }> = [
    { savingsGoalId: vacation.id, amount: 60000, date: day(2026, 7, 20), note: 'Startguthaben' },
    { savingsGoalId: emergency.id, amount: 180000, date: day(2026, 7, 20), note: 'Startguthaben' },
  ]
  for (const [y, m] of MONTHS) {
    const date = day(y, m, 2)
    if (!isPast(date)) continue
    executions.push({ savingsGoalId: vacation.id, amount: 15000, date, note: 'Monatsrate' })
    executions.push({ savingsGoalId: emergency.id, amount: 20000, date, note: 'Monatsrate' })
    executions.push({ savingsGoalId: car.id, amount: 7500, date, note: 'Monatsrate' })
  }
  // ADR-0001: Ferienwohnung als Ausgabe oben + Entnahme aus dem Topf.
  executions.push({ savingsGoalId: vacation.id, amount: -48000, date: day(2026, 10, 3), note: 'Ferienwohnung Ostsee' })
  // ADR-0004: Geschenke-Rest in den Urlaubstopf, Lebensmittel-Ueberziehung aus dem Notgroschen.
  executions.push({ savingsGoalId: vacation.id, amount: 5000, date: day(2026, 10, 1), note: 'Rest Geschenke-Budget', sourceBudgetId: gifts.id })
  executions.push({ savingsGoalId: emergency.id, amount: -4000, date: day(2026, 8, 24), note: 'Ausgleich Grillfest-Woche', sourceBudgetId: groceries.id })
  // Werkstatt aus dem Auto-Topf (Doppelbuchung).
  executions.push({ savingsGoalId: car.id, amount: -18900, date: day(2026, 9, 29), note: 'Bremsbeläge vorne' })
  await prisma.expenseTransaction.create({
    data: {
      householdId,
      userId: jan.id,
      budgetId: null,
      amount: 18900,
      description: 'Werkstatt: Bremsbeläge vorne (aus Spartopf)',
      date: day(2026, 9, 29),
    },
  })

  for (const execution of executions.filter((e) => isPast(e.date))) {
    await prisma.savingsGoalExecution.create({ data: execution })
  }

  const [expenseCount, incomeCount, executionCount] = await Promise.all([
    prisma.expenseTransaction.count({ where: { householdId } }),
    prisma.incomeTransaction.count({ where: { householdId } }),
    prisma.savingsGoalExecution.count({ where: { savingsGoal: { householdId } } }),
  ])
  console.log(`Haushalt "${HOUSEHOLD_NAME}" angelegt (${householdId}):`)
  console.log(`  ${expenseCount} Ausgaben, ${incomeCount} Einnahmen, ${executionCount} Topf-Bewegungen`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
