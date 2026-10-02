import type { Transaction } from '@/types'
import type { TransactionPage } from '@/services/transactions.service'

const DIRECT_TRANSACTION_TYPES = new Set(['DEBIT_CARD', 'PIX', 'BOLETO'])

export function statementHighlightDay(transaction: Pick<Transaction, 'date'>): string {
  return transaction.date.slice(0, 10)
}

export function findStatementHighlightPage(
  pages: readonly TransactionPage[] | undefined,
  transactionId: string,
): number {
  return pages?.findIndex((page) => page.items.some((item) => item.id === transactionId)) ?? -1
}

export function shouldFetchStatementHighlightPage(input: {
  targetId: string | null
  targetPage: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
}): boolean {
  return Boolean(input.targetId) && input.targetPage < 0 && input.hasNextPage &&
    !input.isFetchingNextPage && !input.isFetchNextPageError
}

export function transactionMatchesStatementSearch(
  transaction: Transaction,
  search: string,
): boolean {
  const normalized = search.trim().toLocaleLowerCase()
  if (!normalized) return true
  const searchable = [
    transaction.title,
    transaction.description,
    transaction.person?.name,
    transaction.paymentReceivable?.person?.name,
    transaction.paymentDebt?.person?.name,
  ]
  return searchable.some((value) => value?.toLocaleLowerCase().includes(normalized))
}

export function transactionMatchesStatementGroup(
  transaction: Pick<Transaction, 'type'>,
  group: 'direct' | undefined,
): boolean {
  return group !== 'direct' || DIRECT_TRANSACTION_TYPES.has(transaction.type)
}
