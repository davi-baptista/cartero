import { api } from '@/lib/api'
import type { Debt, InstallmentScope, TransactionType } from '@/types'

export async function getDebts(filters?: { personId?: string; startDate?: string; endDate?: string }): Promise<Debt[]> {
  const { data } = await api.get<Debt[]>('/debts', { params: filters })
  return data
}

export async function getDebt(id: string): Promise<Debt> {
  const { data } = await api.get<Debt>(`/debts/${id}`)
  return data
}

export async function createDebt(payload: {
  creditorName?: string
  personId?: string
  title: string
  amount: number
  occurredAt: string
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
    occurredAt: string
    dueDate: string
    description: string
    isAlertEnabled: boolean
    isPaid: boolean
    paymentBankId: string
    paymentType: TransactionType
    /** Data em que o pagamento aconteceu — grava `paidAt` e a transação. */
    paymentDate: string
  }>,
  scope?: InstallmentScope,
): Promise<Debt | Debt[]> {
  const { data } = await api.patch<Debt | Debt[]>(`/debts/${id}`, payload, {
    params: scope ? { scope } : undefined,
  })
  return data
}

export async function deleteDebt(
  id: string,
  scope?: InstallmentScope,
  preserveTransaction = false,
): Promise<void> {
  await api.delete(`/debts/${id}`, {
    params: {
      ...(scope ? { scope } : {}),
      ...(preserveTransaction ? { preserveTransaction: 'true' } : {}),
    },
  })
}

/**
 * Corrige a data real do pagamento de um item JÁ resolvido.
 *
 * Distinto do `update`: aquele bloqueia edição financeira de item pago, e
 * essa proteção continua. Aqui só a dimensão temporal muda — valor,
 * vencimento e contraparte ficam intactos.
 */
export async function updateDebtSettlementDate(
  id: string,
  paidAt: string,
): Promise<Debt> {
  const { data } = await api.patch(`/debts/${id}/settlement-date`, { paidAt })
  return data
}
