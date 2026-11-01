/**
 * Prueft die Umschlag-Migration (ADR-0005, #155): Jeder Umschlag muss heute
 * denselben Saldo haben wie vorher sein Budget (ADR-0004) bzw. sein Sparziel
 * (Summe der Executions). Nur lesend.
 *
 *   DATABASE_URL=… npx tsx scripts/verify-envelope-migration.ts
 *
 * Gebraucht nach der Migration auf einer Kopie der Produktionsdaten und
 * beim Umstieg gegen Produktion (#164). Exit-Code 1 bei Abweichungen.
 */
import { PrismaClient } from '@prisma/client'
import { computeBudgetBalances } from '../server/utils/budget-balance'
import { computeEnvelopeBalances } from '../server/utils/envelope-balance'

const prisma = new PrismaClient()

async function verifyHousehold(householdId: string, name: string, at: Date): Promise<number> {
  const [budgets, legacyExpenses, executions, goals, envelopes, expenses, incomes, transfers] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId },
      select: {
        id: true, frequency: true, balanceSince: true, closedAt: true, carryoverToBudgetId: true,
        versions: { select: { amount: true, validFrom: true } },
      },
    }),
    prisma.expenseTransaction.findMany({ where: { householdId, deletedAt: null }, select: { budgetId: true, amount: true, date: true } }),
    prisma.savingsGoalExecution.findMany({
      where: { savingsGoal: { householdId } },
      select: { savingsGoalId: true, sourceBudgetId: true, amount: true, date: true },
    }),
    prisma.savingsGoal.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.envelope.findMany({ where: { householdId }, select: { id: true, name: true, balanceSince: true, closedAt: true, carryoverToEnvelopeId: true } }),
    prisma.expenseTransaction.findMany({ where: { householdId, deletedAt: null }, select: { envelopeId: true, amount: true, date: true } }),
    prisma.incomeTransaction.findMany({ where: { householdId, deletedAt: null }, select: { envelopeId: true, amount: true, date: true } }),
    prisma.envelopeTransfer.findMany({
      where: { householdId },
      select: { fromEnvelopeId: true, toEnvelopeId: true, amount: true, date: true, allocationPeriodStart: true },
    }),
  ])

  const expected = new Map<string, number>()
  for (const [id, balance] of computeBudgetBalances(budgets, legacyExpenses, executions, at)) expected.set(id, balance.balance)
  for (const goal of goals) {
    expected.set(goal.id, executions.filter((execution) => execution.savingsGoalId === goal.id).reduce((sum, execution) => sum + execution.amount, 0))
  }

  const actual = computeEnvelopeBalances(envelopes, { expenses, incomes, transfers }, at)
  let mismatches = 0
  for (const envelope of envelopes) {
    const before = expected.get(envelope.id)
    const after = actual.get(envelope.id)?.balance
    if (before === undefined) {
      console.log(`  ? ${envelope.name}: kein Gegenstueck im Altbestand (neu angelegt?)`)
      continue
    }
    const ok = before === after
    if (!ok) mismatches++
    console.log(`  ${ok ? '✓' : '✗'} ${envelope.name}: vorher ${before}, nachher ${after}`)
  }
  for (const id of expected.keys()) {
    if (!envelopes.some((envelope) => envelope.id === id)) {
      mismatches++
      console.log(`  ✗ ${id}: fehlt als Umschlag`)
    }
  }
  console.log(`${mismatches === 0 ? 'OK' : 'ABWEICHUNG'} — ${name} (${envelopes.length} Umschlaege)`)
  return mismatches
}

async function main() {
  const at = new Date()
  const households = await prisma.household.findMany({ select: { id: true, name: true } })
  let mismatches = 0
  for (const household of households) mismatches += await verifyHousehold(household.id, household.name, at)
  console.log(mismatches === 0 ? '\nAlle Salden stimmen.' : `\n${mismatches} Abweichung(en).`)
  process.exitCode = mismatches === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
