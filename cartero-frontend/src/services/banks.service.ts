import { api } from '@/lib/api'
import type { Bank } from '@/types'

export async function getBanks(): Promise<Bank[]> {
  const { data } = await api.get<Bank[]>('/banks')
  return data
}

export async function getBank(id: string): Promise<Bank> {
  const { data } = await api.get<Bank>(`/banks/${id}`)
  return data
}

export async function createBank(payload: {
  name: string
  invoiceCloseDate: number
  invoiceDueDate: number
}): Promise<Bank> {
  const { data } = await api.post<Bank>('/banks', payload)
  return data
}

export async function updateBank(
  id: string,
  payload: Partial<{
    name: string
    invoiceCloseDate: number
    invoiceDueDate: number
  }>,
): Promise<Bank> {
  const { data } = await api.patch<Bank>(`/banks/${id}`, payload)
  return data
}

export async function deleteBank(id: string): Promise<void> {
  await api.delete(`/banks/${id}`)
}
