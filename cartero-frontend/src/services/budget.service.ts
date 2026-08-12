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
  /** Custo real do mês: faturas + pagamentos diretos + dívidas. */
  totalToPay: number
  totalPaid: number
  totalPending: number
  invoices: Invoice[]
}

export async function getBudget(params: { month: number; year: number }): Promise<BudgetSummary> {
  const { data } = await api.get<BudgetSummary>('/budget', { params })
  return data
}
