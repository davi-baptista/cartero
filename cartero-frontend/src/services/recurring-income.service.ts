import { api } from '@/lib/api'
import type { RecurringIncomeRule } from '@/types'

export type CreateRecurringIncomePayload = {
  title: string
  amount: number
  dayOfMonth: number
  firstOccurrence?: string
  counterpartyName?: string
}

export type UpdateRecurringIncomePayload = Partial<
  Pick<CreateRecurringIncomePayload, 'title' | 'amount' | 'dayOfMonth' | 'counterpartyName'>
> & { isActive?: boolean }

export async function getRecurringIncomes(): Promise<RecurringIncomeRule[]> {
  const { data } = await api.get<RecurringIncomeRule[]>('/recurring-incomes')
  return data
}

export async function createRecurringIncome(payload: CreateRecurringIncomePayload) {
  const { data } = await api.post<RecurringIncomeRule>('/recurring-incomes', payload)
  return data
}

export async function updateRecurringIncome(id: string, payload: UpdateRecurringIncomePayload) {
  const { data } = await api.patch<RecurringIncomeRule>(`/recurring-incomes/${id}`, payload)
  return data
}

export async function deactivateRecurringIncome(id: string) {
  const { data } = await api.delete<RecurringIncomeRule>(`/recurring-incomes/${id}`)
  return data
}
