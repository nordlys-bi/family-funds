/*
 * recurring-coverage — monatliche Coverage-Aggregation fuer Recurring-
 * Plaene (FixedCostPlan / IncomePlan).
 *
 * Ursprung: issue #59, inline in `api/households/current.get.ts`. Fuer
 * issue #98 (Dashboard „Handlungsbedarf" zeigt fällige, noch nicht
 * gedeckte Pläne) hierher extrahiert, damit beide Endpoints dieselbe
 * Bucket-Matching-Logik nutzen.
 */
import {
  computeCoveragePercent,
  getRecurringPeriodsInMonth,
  isDateInBucket,
} from './recurring-periods'

export type CoveragePlanLike = {
  id: string
  startDate: Date
  endDate: Date | null
  frequency: string
}

export type CoveragePlanTx = {
  planId: string
  date: Date
}

export type PlanCoverage = {
  /** Anzahl faelliger Period-Buckets im aktuellen Monat. */
  due: number
  /** Anzahl Buckets, fuer die mind. eine Transaktion existiert. */
  paid: number
  /** paid / due * 100 (0, wenn due === 0). */
  percent: number
  /** Naechste Faelligkeit als ISO-String, null wenn keine. */
  nextDueDate: string | null
}

/**
 * Baut fuer jede Plan-ID eine Set<bucketKey> der bereits bezahlten
 * Buckets im aktuellen Monat. `monthEnd` wird von
 * `getRecurringPeriodsInMonth` intern abgeleitet und hier nur der
 * Signatur-Symmetrie halber mitgefuehrt.
 */
export function indexPaidBuckets(
  plans: CoveragePlanLike[],
  transactions: CoveragePlanTx[],
  monthStart: Date,
  _monthEnd: Date,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const plan of plans) {
    const { buckets } = getRecurringPeriodsInMonth(
      plan,
      monthStart.getFullYear(),
      monthStart.getMonth(),
    )
    const paidKeys = new Set<string>()
    for (const bucket of buckets) {
      for (const tx of transactions) {
        if (tx.planId !== plan.id) continue
        if (isDateInBucket(tx.date, bucket)) {
          paidKeys.add(bucket.key)
          break
        }
      }
    }
    result.set(plan.id, paidKeys)
  }
  return result
}

/**
 * Coverage (`due` / `paid` / `percent` / `nextDueDate`) fuer einen
 * einzelnen Plan im aktuellen Monat.
 */
export function computePlanCoverage(
  plan: CoveragePlanLike,
  paidByPlan: Map<string, Set<string>>,
  monthStart: Date,
  _monthEnd: Date,
): PlanCoverage {
  const { buckets, nextDueDate } = getRecurringPeriodsInMonth(
    plan,
    monthStart.getFullYear(),
    monthStart.getMonth(),
  )
  const paidKeys = paidByPlan.get(plan.id) ?? new Set<string>()
  const due = buckets.length
  const paid = paidKeys.size
  return {
    due,
    paid,
    percent: computeCoveragePercent(paid, due),
    nextDueDate: nextDueDate ? nextDueDate.toISOString() : null,
  }
}

/**
 * Issue #98: zaehlt fuer eine Plan-Liste, wie viele in diesem Monat
 * faellig sind (`due > 0`) und davon wie viele noch nicht voll gedeckt
 * (`percent < 100`).
 */
export function countOpenPlans(
  plans: CoveragePlanLike[],
  transactions: CoveragePlanTx[],
  monthStart: Date,
  monthEnd: Date,
): { due: number; open: number } {
  const paidByPlan = indexPaidBuckets(plans, transactions, monthStart, monthEnd)
  let due = 0
  let open = 0
  for (const plan of plans) {
    const coverage = computePlanCoverage(plan, paidByPlan, monthStart, monthEnd)
    if (coverage.due > 0) {
      due += 1
      if (coverage.percent < 100) open += 1
    }
  }
  return { due, open }
}
