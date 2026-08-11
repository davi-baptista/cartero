import { api } from '@/lib/api'
import type { Transaction, TransactionFilters, TransactionType, InstallmentScope } from '@/types'

function normalizeTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    amount: Number(transaction.amount),
  }
}

function normalizeTransactionResponse(
  data: Transaction | Transaction[],
): Transaction | Transaction[] {
  return Array.isArray(data) ? data.map(normalizeTransaction) : normalizeTransaction(data)
}

export async function getTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
  const { data } = await api.get<Transaction[]>('/transactions', { params: filters })
  return data.map(normalizeTransaction)
}

export async function getTransaction(id: string): Promise<Transaction> {
  const { data } = await api.get<Transaction>(`/transactions/${id}`)
  return normalizeTransaction(data)
}

export async function createTransaction(payload: {
  bankId: string
  categoryId: string
  type: TransactionType
  title: string
  amount: number
  isRefund?: boolean
  date: string
  description?: string
  installments?: number
  personId?: string
}): Promise<Transaction | Transaction[]> {
  const { data } = await api.post<Transaction | Transaction[]>('/transactions', payload)
  return normalizeTransactionResponse(data)
}

export async function updateTransaction(
  id: string,
  payload: Partial<{
    bankId: string
    categoryId: string
    type: TransactionType
    title: string
    amount: number
    isRefund?: boolean
    date: string
    description: string
    personId: string | null
    confirmReopenClosedInvoice: boolean
  }>,
  scope?: InstallmentScope,
): Promise<Transaction | Transaction[]> {
  const { data } = await api.patch<Transaction | Transaction[]>(
    `/transactions/${id}`,
    payload,
    { params: scope ? { scope } : undefined },
  )
  return normalizeTransactionResponse(data)
}

export async function deleteTransaction(id: string, scope?: InstallmentScope): Promise<void> {
  await api.delete(`/transactions/${id}`, {
    params: scope ? { scope } : undefined,
  })
}
