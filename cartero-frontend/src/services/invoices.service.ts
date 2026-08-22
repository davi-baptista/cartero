import { api } from '@/lib/api'
import type { Invoice, InvoiceStatus } from '@/types'

/**
 * Converte os campos monetários para número.
 *
 * A API serializa `Decimal` do Prisma como STRING no JSON. Os tipos do
 * frontend declaram `number`, então o TypeScript não acusa nada — e qualquer
 * soma passa a concatenar texto: `0 + "430.75" + "96.5"` virava
 * `"0430.7596.5"`, que chegava em `formatCurrency` como `NaN`.
 *
 * Foi exatamente o que aconteceu no cabeçalho da fatura ("R$ NaN sua parte").
 * `transactions.service.ts` já normalizava na entrada; o detalhe da fatura traz
 * as transações ANINHADAS e passava sem conversão.
 *
 * A conversão fica aqui, na borda: os helpers de agregação
 * (`money-semantics`, `calendar-events`) recebem números de verdade e não
 * precisam de `Number()` defensivo espalhado por cada chamada.
 */
function normalizeInvoice(invoice: Invoice): Invoice {
  return {
    ...invoice,
    totalAmount: Number(invoice.totalAmount),
    transactions: invoice.transactions?.map((tx) => ({
      ...tx,
      amount: Number(tx.amount),
    })),
  }
}

export async function getInvoices(params?: {
  bankId?: string
  month?: number
  year?: number
}): Promise<Invoice[]> {
  const { data } = await api.get<Invoice[]>('/invoices', { params })
  return data.map(normalizeInvoice)
}

export async function getBankInvoices(bankId: string): Promise<Invoice[]> {
  const { data } = await api.get<Invoice[]>(`/banks/${bankId}/invoices`)
  return data.map(normalizeInvoice)
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data } = await api.get<Invoice>(`/invoices/${id}`)
  return normalizeInvoice(data)
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice> {
  const { data } = await api.patch<Invoice>(`/invoices/${id}`, { status })
  return normalizeInvoice(data)
}

/** Desfaz o pagamento — o status volta a ser o que as datas determinam. */
export async function reopenInvoice(id: string): Promise<Invoice> {
  const { data } = await api.post<Invoice>(`/invoices/${id}/reopen`)
  return normalizeInvoice(data)
}

/** Reabre todas as faturas pagas; devolve os ids para permitir desfazer. */
export async function reopenAllPaidInvoices(): Promise<{ ids: string[]; count: number }> {
  const { data } = await api.post<{ ids: string[]; count: number }>(
    '/invoices/reopen-all-paid',
  )
  return data
}

/** Remarca como pagas as faturas indicadas. Ignora as que já estão pagas. */
export async function markManyInvoicesPaid(ids: string[]): Promise<{ count: number }> {
  const { data } = await api.post<{ count: number }>('/invoices/mark-many-paid', { ids })
  return data
}
