import { api } from '@/lib/api'
import type { Receivable, InstallmentScope } from '@/types'

export async function getReceivables(filters?: { personId?: string; startDate?: string; endDate?: string }): Promise<Receivable[]> {
  const { data } = await api.get<Receivable[]>('/receivables', { params: filters })
  return data
}

export async function getReceivable(id: string): Promise<Receivable> {
  const { data } = await api.get<Receivable>(`/receivables/${id}`)
  return data
}

export async function createReceivable(payload: {
  debtorName?: string
  personId?: string
  title: string
  amount: number
  dueDate: string
  description?: string
  installments?: number
}): Promise<Receivable | Receivable[]> {
  const { data } = await api.post<Receivable | Receivable[]>('/receivables', payload)
  return data
}

export async function updateReceivable(
  id: string,
  payload: Partial<{
    debtorName: string
    title: string
    amount: number
    dueDate: string
    description: string
    isPaid: boolean
  }>,
  scope?: InstallmentScope,
): Promise<Receivable | Receivable[]> {
  const { data } = await api.patch<Receivable | Receivable[]>(`/receivables/${id}`, payload, {
    params: scope ? { scope } : undefined,
  })
  return data
}

export async function deleteReceivable(id: string, scope?: InstallmentScope): Promise<void> {
  await api.delete(`/receivables/${id}`, {
    params: scope ? { scope } : undefined,
  })
}
