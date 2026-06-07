import { createError } from 'h3'

export const transactionKinds = ['expense', 'income'] as const
export type TransactionKind = (typeof transactionKinds)[number]

export function assertTransactionKind(value: unknown): TransactionKind {
  if (typeof value === 'string' && transactionKinds.includes(value as TransactionKind)) {
    return value as TransactionKind
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid transaction kind.',
  })
}
