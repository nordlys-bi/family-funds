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
 * dieselben Daten erzeugen. Bildet ADR-0005 ab: alle fuenf Gruppen von
 * Umschlaegen, gebuchte Zuteilungen (eine geaenderte, eine ausgelassene),
 * Fixkosten-Umschlaege aus Plaenen, ein in einen Monatsumschlag geschlossener
 * Wochenumschlag (Frequenzwechsel), Gutschriften auf Umschlaege, Umbuchungen
 * und Ausgaben aus Sparzielen.
 */
import { PrismaClient, Role, type AllocationSource, type EnvelopeGroup, type Frequency } from '@prisma/client'
import { ensureAllocations } from '../server/utils/envelope-store'

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
// Startpunkt von "Zu verteilen": vor allen Zuteilungen, damit jede davon
// von dort abgeht und die Invariante aus ADR-0005 ohne Altbestand aufgeht.
const LEDGER_SINCE = day(2026, 7, 20)

async function main() {
  const existing = await prisma.household.findMany({ where: { name: HOUSEHOLD_NAME }, select: { id: true } })
  if (existing.length > 0) {
    // Uebertrags-Verweise zuerst entkoppeln (onDelete: NoAction). Budget nur
    // fuer Haushalte, die noch aus der Zeit vor ADR-0005 stammen.
    await prisma.budget.updateMany({
      where: { householdId: { in: existing.map((h) => h.id) } },
      data: { carryoverToBudgetId: null },
    })
    await prisma.envelope.updateMany({
      where: { householdId: { in: existing.map((h) => h.id) } },
      data: { carryoverToEnvelopeId: null },
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
      ledgerSince: LEDGER_SINCE,
      openingBalance: 300000,
      members: {
        create: [
          { userId: jan.id, role: Role.OWNER },
          { userId: sarah.id, role: Role.MEMBER },
        ],
      },
    },
  })
  const householdId = household.id

  // --- Umschlaege ---------------------------------------------------------

  async function createEnvelope(
    name: string,
    group: EnvelopeGroup,
    frequency: Frequency,
    balanceSince: Date,
    rule: { source: AllocationSource; amount?: number; target?: number },
  ) {
    return prisma.envelope.create({
      data: {
        householdId,
        name,
        group,
        frequency,
        balanceSince,
        allocationSource: rule.source,
        allocationAmount: rule.amount === undefined ? null : rule.amount * 100,
        targetAmount: rule.target === undefined ? null : rule.target * 100,
      },
    })
  }
  const fixedAmount = (amount: number) => ({ source: 'FIXED' as const, amount })
  const fromPlans = { source: 'PLANS' as const }
  const noAllocation = { source: 'NONE' as const }

  // Laufende Ausgaben. Lebensmittel: 220 €/Woche, ab 7.9. 240 € — die alten
  // Wochen werden unten auf ihren damaligen Betrag gesetzt.
  const groceries = await createEnvelope('Lebensmittel', 'RUNNING', 'WEEKLY', START_WEEK, fixedAmount(240))
  const drugstore = await createEnvelope('Drogerie', 'RUNNING', 'MONTHLY', START_MONTH, fixedAmount(60))
  const kids = await createEnvelope('Kinder', 'RUNNING', 'MONTHLY', START_MONTH, fixedAmount(150))
  const leisure = await createEnvelope('Freizeit & Ausgehen', 'RUNNING', 'MONTHLY', START_MONTH, fixedAmount(120))
  // Frequenzwechsel: "Tanken" lief woechentlich und wurde zum 31.08. in den
  // neuen Monatsumschlag "Mobilität" geschlossen.
  const fuelWeekly = await createEnvelope('Tanken (wöchentlich)', 'RUNNING', 'WEEKLY', START_WEEK, fixedAmount(45))
  const mobility = await createEnvelope('Mobilität', 'RUNNING', 'MONTHLY', day(2026, 9, 1), fixedAmount(190))

  // Fixkosten: Zuteilung aus den verknuepften Plaenen.
  const housing = await createEnvelope('Wohnen', 'FIXED', 'MONTHLY', START_MONTH, fromPlans)
  const contracts = await createEnvelope('Verträge & Abos', 'FIXED', 'MONTHLY', START_MONTH, fromPlans)
  const childcare = await createEnvelope('Kinderbetreuung', 'FIXED', 'MONTHLY', START_MONTH, fromPlans)
  const insurance = await createEnvelope('Versicherungen', 'FIXED', 'MONTHLY', START_MONTH, fromPlans)

  // Ruecklagen: regelmaessig, ohne festes Ziel.
  const gifts = await createEnvelope('Geschenke', 'RESERVE', 'MONTHLY', START_MONTH, fixedAmount(50))
  const clothes = await createEnvelope('Kleidung', 'RESERVE', 'MONTHLY', START_MONTH, fixedAmount(40))
  await createEnvelope('Weihnachten', 'RESERVE', 'MONTHLY', START_MONTH, fixedAmount(60))

  // Sparziele. "Auto-Reparatur" mit Zuteilung, der Rest wird von Hand bespart.
  const vacation = await createEnvelope('Urlaub', 'SAVINGS', 'MONTHLY', START_MONTH, { source: 'FIXED', amount: 150, target: 2500 })
  const emergency = await createEnvelope('Notgroschen', 'SAVINGS', 'MONTHLY', START_MONTH, { source: 'NONE', target: 5000 })
  const car = await createEnvelope('Auto-Reparatur', 'SAVINGS', 'MONTHLY', START_MONTH, { source: 'FIXED', amount: 75, target: 1500 })

  // Persoenlich: waechst nur durch Gutschriften und Umbuchungen.
  const janPersonal = await createEnvelope('Jan', 'PERSONAL', 'MONTHLY', START_MONTH, noAllocation)
  const sarahPersonal = await createEnvelope('Sarah', 'PERSONAL', 'MONTHLY', START_MONTH, noAllocation)

  // --- Plaene: Fixkosten und Einnahmen ------------------------------------

  type PlanSpec = { name: string; amount: number; frequency: Frequency; dayOfMonth: number; months?: number[]; envelopeId?: string }
  const fixedCostSpecs: PlanSpec[] = [
    { name: 'Miete', amount: 1250, frequency: 'MONTHLY', dayOfMonth: 1, envelopeId: housing.id },
    { name: 'Strom (Abschlag)', amount: 85, frequency: 'MONTHLY', dayOfMonth: 5, envelopeId: housing.id },
    { name: 'Internet', amount: 39.99, frequency: 'MONTHLY', dayOfMonth: 8, envelopeId: housing.id },
    { name: 'Rundfunkbeitrag', amount: 55.08, frequency: 'QUARTERLY', dayOfMonth: 15, months: [7, 10], envelopeId: housing.id },
    { name: 'Handyverträge', amount: 29.98, frequency: 'MONTHLY', dayOfMonth: 15, envelopeId: contracts.id },
    { name: 'Deutschlandticket', amount: 58, frequency: 'MONTHLY', dayOfMonth: 1, envelopeId: contracts.id },
    { name: 'Streaming', amount: 13.99, frequency: 'MONTHLY', dayOfMonth: 20, envelopeId: contracts.id },
    { name: 'Kita-Beitrag', amount: 210, frequency: 'MONTHLY', dayOfMonth: 3, envelopeId: childcare.id },
    { name: 'Kfz-Versicherung', amount: 142.3, frequency: 'QUARTERLY', dayOfMonth: 1, months: [7, 10], envelopeId: insurance.id },
    { name: 'Privathaftpflicht', amount: 74.9, frequency: 'YEARLY', dayOfMonth: 12, months: [9], envelopeId: insurance.id },
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
        envelopeId: spec.envelopeId ?? null,
      },
    })
    // Erst ab August: Davor gibt es die Fixkosten-Umschlaege noch nicht.
    for (const [y, m] of MONTHS) {
      if (spec.months && !spec.months.includes(m)) continue
      const date = day(y, m, spec.dayOfMonth)
      if (!isPast(date)) continue
      await prisma.expenseTransaction.create({
        data: {
          householdId,
          userId: jan.id,
          amount: plan.amount,
          description: spec.name,
          date,
          fixedCostPlanId: plan.id,
          envelopeId: spec.envelopeId ?? null,
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
      if (date < LEDGER_SINCE || !isPast(date)) continue
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

  // Gutschriften: Verkaeufe zugunsten eines Umschlags.
  const credits: Array<{ envelopeId: string; userId: string; amount: number; description: string; date: Date }> = [
    { envelopeId: kids.id, userId: sarah.id, amount: 6000, description: 'Kinderfahrrad verkauft (Kleinanzeigen)', date: day(2026, 9, 21) },
    { envelopeId: janPersonal.id, userId: jan.id, amount: 18000, description: 'Alte Kamera verkauft', date: day(2026, 8, 16) },
    { envelopeId: sarahPersonal.id, userId: sarah.id, amount: 9500, description: 'Kleiderschrank verkauft', date: day(2026, 9, 6) },
  ]
  for (const credit of credits) {
    await prisma.incomeTransaction.create({ data: { householdId, ...credit } })
  }

  // --- Alltagsausgaben ----------------------------------------------------

  type Expense = { envelopeId: string | null; amount: number; description: string; date: Date }
  const expenses: Expense[] = []
  const add = (envelopeId: string | null, amount: number, description: string, date: Date) => {
    if (isPast(date)) expenses.push({ envelopeId, amount, description, date })
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
    add(clothes.id, euros(18, 40), pick(['Kinderkleidung C&A', 'Schuhe Deichmann']), day(y, m, 14))
    if (m === 8) add(kids.id, 7450, 'Schulranzen & Schulbedarf', day(y, m, 25))
    if (m === 9) add(kids.id, 2400, 'Kita-Ausflug Zoo', day(y, m, 18))
    if (m === 10) add(kids.id, euros(15, 25), 'Bastelbedarf Herbst', day(y, m, 9))

    add(leisure.id, euros(28, 55), pick(['Pizzeria Da Mario', 'Thai Imbiss', 'Biergarten']), day(y, m, 9))
    add(leisure.id, euros(20, 32), pick(['Kino', 'Freibad', 'Minigolf']), day(y, m, 16))
    if (random() < 0.7) add(leisure.id, euros(8, 15), 'Eisdiele', day(y, m, 22))

    // Geschenke: nicht jeden Monat — der Saldo waechst und wird im Oktober
    // teilweise in den Urlaub umgebucht.
    if (m === 8) add(gifts.id, 3500, 'Geburtstag Oma', day(y, m, 11))
    if (m === 10) add(gifts.id, 2290, 'Kindergeburtstag Lea', day(y, m, 8))

    // Ohne Umschlag: geht direkt von "Zu verteilen" ab.
    add(null, euros(9, 25), pick(['Apotheke', 'Post / Paket', 'Schlüsseldienst Ersatzschlüssel']), day(y, m, 13))
  }
  // Ein Umschlag im Minus, damit die Bewertung nach Saldo etwas zu zeigen hat.
  add(leisure.id, 28000, 'Konzertkarten', day(2026, 10, 24))
  // Ausgaben aus Sparzielen und persoenlichen Umschlaegen sind normale Ausgaben.
  add(vacation.id, 48000, 'Ferienwohnung Ostsee', day(2026, 10, 3))
  add(car.id, 18900, 'Werkstatt: Bremsbeläge vorne', day(2026, 9, 29))
  add(janPersonal.id, 6490, 'Fachbuch & Kopfhörer', day(2026, 9, 12))
  add(sarahPersonal.id, 3200, 'Nähkurs', day(2026, 10, 7))

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
      envelopeId: groceries.id,
      amount: 1999,
      description: 'Doppelt erfasst',
      date: day(2026, 10, 6),
      deletedAt: day(2026, 10, 6),
    },
  })

  // --- Zuteilungen und Umbuchungen -----------------------------------------

  await prisma.envelope.update({
    where: { id: fuelWeekly.id },
    data: { closedAt: day(2026, 8, 31), carryoverToEnvelopeId: mobility.id },
  })

  // Derselbe Weg wie in der App: Zuteilungen bucht `ensureAllocations`.
  await ensureAllocations(householdId, today, prisma)
  // Gebuchte Zuteilungen liegen fest und lassen sich einzeln aendern: die
  // alten Lebensmittel-Wochen vor der Erhoehung, und Geschenke im Oktober
  // ausgesetzt (Betrag 0, nicht geloescht).
  await prisma.envelopeTransfer.updateMany({
    where: { toEnvelopeId: groceries.id, allocationPeriodStart: { lt: day(2026, 9, 7) } },
    data: { amount: 22000 },
  })
  await prisma.envelopeTransfer.updateMany({
    where: { toEnvelopeId: gifts.id, allocationPeriodStart: day(2026, 10, 1) },
    data: { amount: 0, note: 'Diesen Monat ausgesetzt' },
  })

  // Umbuchungen; `null` ist "Zu verteilen".
  const transfers: Array<{ fromEnvelopeId: string | null; toEnvelopeId: string | null; amount: number; date: Date; note: string }> = [
    { fromEnvelopeId: null, toEnvelopeId: vacation.id, amount: 60000, date: START_MONTH, note: 'Startguthaben' },
    { fromEnvelopeId: null, toEnvelopeId: emergency.id, amount: 180000, date: START_MONTH, note: 'Startguthaben' },
    // Der Jahresbeitrag der Haftpflicht kommt, bevor sein Anteil angespart ist.
    { fromEnvelopeId: null, toEnvelopeId: insurance.id, amount: 7500, date: START_MONTH, note: 'Startguthaben' },
    { fromEnvelopeId: gifts.id, toEnvelopeId: vacation.id, amount: 5000, date: day(2026, 10, 1), note: 'Rest Geschenke' },
    { fromEnvelopeId: emergency.id, toEnvelopeId: groceries.id, amount: 4000, date: day(2026, 8, 24), note: 'Ausgleich Grillfest-Woche' },
  ]
  for (const [y, m] of MONTHS) {
    // Ueberschuss des Monats beiseitelegen, sonst waechst "Zu verteilen" nur.
    transfers.push({ fromEnvelopeId: null, toEnvelopeId: emergency.id, amount: 150000, date: day(y, m, 30), note: 'Monatsüberschuss' })
  }
  for (const transfer of transfers.filter((item) => isPast(item.date))) {
    await prisma.envelopeTransfer.create({ data: { householdId, userId: jan.id, ...transfer } })
  }

  const [envelopeCount, expenseCount, incomeCount, transferCount] = await Promise.all([
    prisma.envelope.count({ where: { householdId } }),
    prisma.expenseTransaction.count({ where: { householdId } }),
    prisma.incomeTransaction.count({ where: { householdId } }),
    prisma.envelopeTransfer.count({ where: { householdId } }),
  ])
  console.log(`Haushalt "${HOUSEHOLD_NAME}" angelegt (${householdId}):`)
  console.log(`  ${envelopeCount} Umschläge, ${expenseCount} Ausgaben, ${incomeCount} Einnahmen, ${transferCount} Zuteilungen und Umbuchungen`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
