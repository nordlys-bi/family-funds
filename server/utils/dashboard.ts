/**
 * Letzte Aktivitaet fuers Dashboard: die letzten 5 Buchungen (Ausgaben und
 * Einnahmen gemischt) aus den letzten 7 Tagen, neueste zuerst.
 */
export type DashboardRecentActivity = {
  id: string
  kind: 'expense' | 'income'
  amount: number
  description: string | null
  date: Date
  envelopeName: string | null
  userDisplayName: string | null
}

type RecentBooking = {
  id: string
  amount: number
  description: string | null
  date: Date
  envelope: { name: string } | null
  user: { displayName: string | null }
}

export function buildRecentActivity(
  expenses: RecentBooking[],
  incomes: RecentBooking[],
  now: Date = new Date(),
): DashboardRecentActivity[] {
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  const entry = (kind: 'expense' | 'income') => (booking: RecentBooking): DashboardRecentActivity => ({
    id: booking.id,
    kind,
    amount: booking.amount,
    description: booking.description,
    date: booking.date,
    envelopeName: booking.envelope?.name ?? null,
    userDisplayName: booking.user.displayName,
  })

  return [...expenses.map(entry('expense')), ...incomes.map(entry('income'))]
    .filter((item) => item.date >= sevenDaysAgo && item.date <= now)
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, 5)
}
