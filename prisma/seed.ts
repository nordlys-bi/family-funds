import { PrismaClient, Role } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Clear existing data in reverse dependency order
  await prisma.savingsGoalExecution.deleteMany()
  await prisma.savingsGoal.deleteMany()
  await prisma.expenseTransaction.deleteMany()
  await prisma.incomeTransaction.deleteMany()
  await prisma.budget.deleteMany()
  await prisma.fixedCostPlan.deleteMany()
  await prisma.incomePlan.deleteMany()
  await prisma.householdMember.deleteMany()
  await prisma.household.deleteMany()
  await prisma.user.deleteMany()

  console.log('Database cleared.')

  // Create Users
  const jan = await prisma.user.create({
    data: {
      oidcSubject: 'mock_user_jan',
      email: 'jan@example.com',
      displayName: 'Jan',
    },
  })

  const sarah = await prisma.user.create({
    data: {
      oidcSubject: 'mock_user_sarah',
      email: 'sarah@example.com',
      displayName: 'Sarah',
    },
  })

  console.log('Users created:', { jan, sarah })

  // Create Households
  const sharedHousehold = await prisma.household.create({
    data: {
      name: 'Gemeinsamer Haushalt',
      currency: 'EUR',
    },
  })

  const janPrivateHousehold = await prisma.household.create({
    data: {
      name: 'Privatkonto Jan',
      currency: 'EUR',
    },
  })

  const sarahPrivateHousehold = await prisma.household.create({
    data: {
      name: 'Privatkonto Sarah',
      currency: 'EUR',
    },
  })

  console.log('Households created:', {
    sharedHousehold,
    janPrivateHousehold,
    sarahPrivateHousehold,
  })

  // Create Household Memberships
  // Jan is OWNER of Shared & JanPrivate
  await prisma.householdMember.create({
    data: {
      userId: jan.id,
      householdId: sharedHousehold.id,
      role: Role.OWNER,
    },
  })

  await prisma.householdMember.create({
    data: {
      userId: jan.id,
      householdId: janPrivateHousehold.id,
      role: Role.OWNER,
    },
  })

  // Sarah is MEMBER of Shared & OWNER of SarahPrivate
  await prisma.householdMember.create({
    data: {
      userId: sarah.id,
      householdId: sharedHousehold.id,
      role: Role.MEMBER,
    },
  })

  await prisma.householdMember.create({
    data: {
      userId: sarah.id,
      householdId: sarahPrivateHousehold.id,
      role: Role.OWNER,
    },
  })

  console.log('Memberships created successfully.')
  console.log('Seeding finished successfully!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
