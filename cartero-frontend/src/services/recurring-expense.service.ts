import { api } from '@/lib/api'
import type { RecurringExpenseRule } from '@/types'

export type CreateRecurringExpensePayload = {
  title: string
  amount: number
  dayOfMonth: number
  firstOccurrence: string
  creditorName?: string
  personId?: string
}

export type UpdateRecurringExpensePayload = Partial<Omit<CreateRecurringExpensePayload, 'firstOccurrence' | 'creditorName' | 'personId'>> & {
  creditorName?: string | null
  personId?: string | null
  isActive?: boolean
}

export async function getRecurringExpenses(): Promise<RecurringExpenseRule[]> {
  const { data } = await api.get<RecurringExpenseRule[]>('/recurring-expenses')
  return data
}

export async function getRecurringExpense(id: string): Promise<RecurringExpenseRule> {
  const { data } = await api.get<RecurringExpenseRule>(`/recurring-expenses/${id}`)
  return data
}

export async function createRecurringExpense(payload: CreateRecurringExpensePayload): Promise<RecurringExpenseRule> {
  const { data } = await api.post<RecurringExpenseRule>('/recurring-expenses', payload)
  return data
}

export async function updateRecurringExpense(id: string, payload: UpdateRecurringExpensePayload): Promise<RecurringExpenseRule> {
  const { data } = await api.patch<RecurringExpenseRule>(`/recurring-expenses/${id}`, payload)
  return data
}

export async function deleteRecurringExpense(id: string): Promise<RecurringExpenseRule> {
  const { data } = await api.delete<RecurringExpenseRule>(`/recurring-expenses/${id}`)
  return data
}

export async function reconcileRecurringExpensePeriod(period: { month: number; year: number }) {
  const { data } = await api.post<{ month: string; created: number }>('/recurring-expenses/reconcile', period)
  return data
}
