import { api } from '@/lib/api'
import type { Receivable, InstallmentScope, TransactionType } from '@/types'

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
  occurredAt: string
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
    occurredAt: string
    dueDate: string
    description: string
    isPaid: boolean
    paymentDate: string
    paymentBankId?: string
    paymentType: TransactionType
  }>,
  scope?: InstallmentScope,
): Promise<Receivable | Receivable[]> {
  const { data } = await api.patch<Receivable | Receivable[]>(`/receivables/${id}`, payload, {
    params: scope ? { scope } : undefined,
  })
  return data
}

export async function deleteReceivable(
  id: string,
  scope?: InstallmentScope,
  preserveTransaction = false,
): Promise<void> {
  await api.delete(`/receivables/${id}`, {
    params: {
      ...(scope ? { scope } : {}),
      ...(preserveTransaction ? { preserveTransaction: 'true' } : {}),
    },
  })
}

/**
 * Corrige a data real do recebimento de um item JÁ resolvido.
 *
 * Distinto do `update`: aquele bloqueia edição financeira de item pago, e
 * essa proteção continua. Aqui só a dimensão temporal muda — valor,
 * vencimento e contraparte ficam intactos.
 */
export async function updateReceivableSettlementDate(
  id: string,
  paidAt: string,
): Promise<Receivable> {
  const { data } = await api.patch(`/receivables/${id}/settlement-date`, { paidAt })
  return data
}
