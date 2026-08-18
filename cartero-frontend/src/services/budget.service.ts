import { api } from '@/lib/api'
import type { Invoice } from '@/types'

export interface BudgetSummary {
  month: number
  year: number
  salary: number | null
  totalInvoices: number
  totalReimbursable: number
  netAmount: number
  /** Débito, PIX e boleto lançados dentro do mês. */
  totalDirectPayments: number
  /** Dívidas com vencimento dentro do mês. */
  totalDebts: number
  /** Quantidade de dívidas com vencimento dentro do mês. */
  debtsCount: number
  /** Quantas dessas dívidas já estão pagas. */
  paidDebtsCount: number
  /** Custo real do mês: faturas + pagamentos diretos + dívidas. */
  totalToPay: number
  totalPaid: number
  totalPending: number
  invoices: Invoice[]
  /**
   * Dívidas do mês, linha a linha. Entradas de pessoa já vêm com o saldo
   * compensado pelo que ela te deve — `offset` é o quanto foi abatido.
   */
  debtBreakdown: Array<{
    kind: 'person' | 'debt'
    id: string | null
    name: string
    amount: number
    offset: number
    isPaid: boolean
  }>
}

export async function getBudget(params: { month: number; year: number }): Promise<BudgetSummary> {
  const { data } = await api.get<BudgetSummary>('/budget', { params })
  return data
}

/** Mês que o orçamento deve abrir: o mais antigo com algo ainda a pagar. */
export async function getBudgetFocus(): Promise<{ month: number; year: number }> {
  const { data } = await api.get<{ month: number; year: number }>('/budget/focus')
  return data
}
