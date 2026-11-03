/**
 * Zustandsbehafteter Ersatz fuer den Prisma-Client: der zweite Adapter hinter
 * dem `db`-Parameter von `ensureAllocations` und `envelope-planning`. Damit
 * pruefen Tests Ergebnisse ueber mehrere Schritte statt Aufrufreihenfolgen und
 * brauchen trotzdem keine Datenbank.
 *
 * Bildet nur ab, was diese Module nutzen. Ein unbekannter Filter wirft, statt
 * still zu passen. `select` wird ignoriert, Prisma-Queries laufen hier also
 * nicht echt.
 */
type Row = Record<string, any>

export type InMemoryTables = {
  household: Row[]
  envelope: Row[]
  envelopeTransfer: Row[]
  fixedCostPlan: Row[]
  incomePlan: Row[]
  expenseTransaction: Row[]
  incomeTransaction: Row[]
}

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return (left ?? null) === (right ?? null)
}

function matchesCondition(value: any, condition: any): boolean {
  if (condition === null || condition instanceof Date || typeof condition !== 'object') return sameValue(value, condition)
  const operators = Object.keys(condition)
  return operators.every((operator) => {
    switch (operator) {
      case 'not':
        return !sameValue(value, condition.not)
      case 'in':
        return condition.in.includes(value)
      case 'gte':
        return value !== null && value !== undefined && value.getTime() >= condition.gte.getTime()
      default:
        throw new Error(`in-memory-db: unsupported filter "${operator}"`)
    }
  })
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    if (key === 'OR') return condition.some((branch: Row) => matches(row, branch))
    return matchesCondition(row[key], condition)
  })
}

function withoutUndefined(data: Row) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
}

/** Unique-Index auf `(toEnvelopeId, allocationPeriodStart)`; NULLs sind in Postgres verschieden. */
function violatesAllocationIndex(rows: Row[], row: Row) {
  if (!row.toEnvelopeId || !row.allocationPeriodStart) return false
  return rows.some((other) => other.toEnvelopeId === row.toEnvelopeId && sameValue(other.allocationPeriodStart, row.allocationPeriodStart))
}

export function createInMemoryDb(seed: Partial<InMemoryTables> = {}) {
  let nextId = 1
  const tables: InMemoryTables = {
    household: [...(seed.household ?? [])],
    envelope: [...(seed.envelope ?? [])],
    envelopeTransfer: [...(seed.envelopeTransfer ?? [])],
    fixedCostPlan: [...(seed.fixedCostPlan ?? [])],
    incomePlan: [...(seed.incomePlan ?? [])],
    expenseTransaction: [...(seed.expenseTransaction ?? [])],
    incomeTransaction: [...(seed.incomeTransaction ?? [])],
  }

  function model(name: keyof InMemoryTables, expand: (row: Row) => Row = (row) => row) {
    const find = (where?: Row) => tables[name].filter((row) => matches(row, where)).map((row) => expand({ ...row }))
    const insert = (data: Row) => {
      const row = { id: `${name}-${nextId++}`, ...withoutUndefined(data) }
      tables[name].push(row)
      return row
    }
    return {
      findMany: async ({ where }: { where?: Row } = {}) => find(where),
      findFirst: async ({ where }: { where?: Row } = {}) => find(where)[0] ?? null,
      findUniqueOrThrow: async ({ where }: { where: Row }) => {
        const [row] = find(where)
        if (!row) throw new Error(`in-memory-db: ${name} not found`)
        return row
      },
      count: async ({ where }: { where?: Row } = {}) => find(where).length,
      create: async ({ data }: { data: Row }) => {
        if (name === 'envelopeTransfer' && violatesAllocationIndex(tables[name], data)) throw new Error('in-memory-db: unique constraint')
        return { ...insert(data) }
      },
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        let count = 0
        for (const row of data) {
          if (name === 'envelopeTransfer' && violatesAllocationIndex(tables[name], row)) {
            if (!skipDuplicates) throw new Error('in-memory-db: unique constraint')
            continue
          }
          insert(row)
          count += 1
        }
        return { count }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables[name].find((item) => matches(item, where))
        if (!row) throw new Error(`in-memory-db: ${name} not found`)
        Object.assign(row, withoutUndefined(data))
        return { ...row }
      },
      delete: async ({ where }: { where: Row }) => {
        const index = tables[name].findIndex((item) => matches(item, where))
        if (index < 0) throw new Error(`in-memory-db: ${name} not found`)
        return tables[name].splice(index, 1)[0]
      },
      deleteMany: async ({ where }: { where?: Row } = {}) => {
        const before = tables[name].length
        tables[name] = tables[name].filter((row) => !matches(row, where))
        return { count: before - tables[name].length }
      },
    }
  }

  const db = {
    household: model('household'),
    // Relation, die `ensureAllocations` per `select` mitlaedt.
    envelope: model('envelope', (row) => ({ ...row, fixedCostPlans: tables.fixedCostPlan.filter((plan) => plan.envelopeId === row.id) })),
    envelopeTransfer: model('envelopeTransfer'),
    fixedCostPlan: model('fixedCostPlan'),
    incomePlan: model('incomePlan'),
    expenseTransaction: model('expenseTransaction'),
    incomeTransaction: model('incomeTransaction'),
    // Ohne Rollback: Die Tests pruefen, dass Fehler vor dem Schreiben fallen.
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(db),
  }

  return { db: db as never, tables }
}
