import { api } from '@/lib/api'
import type { Invoice } from '@/types'

export interface BudgetSummary {
  month: number
  year: number
  salary: number | null
  totalInvoices: number
  totalReimbursable: number
  netAmount: number
  invoices: Invoice[]
}

export async function getBudget(params: { month: number; year: number }): Promise<BudgetSummary> {
  const { data } = await api.get<BudgetSummary>('/budget', { params })
  return data
}
