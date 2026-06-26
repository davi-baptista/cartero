import { api } from '@/lib/api'
import type { Invoice, InvoiceStatus } from '@/types'

export async function getInvoices(params?: {
  bankId?: string
  month?: number
  year?: number
}): Promise<Invoice[]> {
  const { data } = await api.get<Invoice[]>('/invoices', { params })
  return data
}

export async function getBankInvoices(bankId: string): Promise<Invoice[]> {
  const { data } = await api.get<Invoice[]>(`/banks/${bankId}/invoices`)
  return data
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data } = await api.get<Invoice>(`/invoices/${id}`)
  return data
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice> {
  const { data } = await api.patch<Invoice>(`/invoices/${id}`, { status })
  return data
}
