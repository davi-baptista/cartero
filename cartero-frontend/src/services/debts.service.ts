import { api } from '@/lib/api'
import type { Debt, InstallmentScope } from '@/types'

export async function getDebts(): Promise<Debt[]> {
  const { data } = await api.get<Debt[]>('/debts')
  return data
}

export async function getDebt(id: string): Promise<Debt> {
  const { data } = await api.get<Debt>(`/debts/${id}`)
  return data
}

export async function createDebt(payload: {
  creditorName: string
  title: string
  amount: number
  dueDate: string
  description?: string
  isAlertEnabled?: boolean
  installments?: number
}): Promise<Debt | Debt[]> {
  const { data } = await api.post<Debt | Debt[]>('/debts', payload)
  return data
}

export async function updateDebt(
  id: string,
  payload: Partial<{
    creditorName: string
    title: string
    amount: number
    dueDate: string
    description: string
    isAlertEnabled: boolean
    isPaid: boolean
  }>,
  scope?: InstallmentScope,
): Promise<Debt | Debt[]> {
  const { data } = await api.patch<Debt | Debt[]>(`/debts/${id}`, payload, {
    params: scope ? { scope } : undefined,
  })
  return data
}

export async function deleteDebt(id: string, scope?: InstallmentScope): Promise<void> {
  await api.delete(`/debts/${id}`, {
    params: scope ? { scope } : undefined,
  })
}
