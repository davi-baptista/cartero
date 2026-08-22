import { api } from '@/lib/api'
import type { Bank, InvoiceStatus } from '@/types'

/** Recorte da listagem: ativos (padrão) ou arquivados. */
export type BankStatusFilter = 'ACTIVE' | 'ARCHIVED'

/**
 * Bancos do usuário. Sem `status`, só os ativos — que é o que todo select de
 * novo lançamento precisa, e portanto o padrão seguro.
 *
 * `ARCHIVED` devolve SÓ os arquivados: a tela de arquivados é uma lista à
 * parte, não um superconjunto, então um `includeArchived` obrigaria o cliente
 * a filtrar de novo o que o servidor já sabia separar.
 */
export async function getBanks(status?: BankStatusFilter): Promise<Bank[]> {
  const { data } = await api.get<Bank[]>('/banks', {
    params: status ? { status } : undefined,
  })
  return data
}

export async function getBank(id: string): Promise<Bank> {
  const { data } = await api.get<Bank>(`/banks/${id}`)
  return data
}

export async function createBank(payload: {
  name: string
  invoiceDueDate: number
  invoiceDueDaysAfterClose?: number
  invoiceCloseDate?: number
}): Promise<Bank> {
  const { data } = await api.post<Bank>('/banks', payload)
  return data
}

export async function updateBank(
  id: string,
  payload: Partial<{
    name: string
    invoiceDueDate: number
    invoiceDueDaysAfterClose?: number
    invoiceCloseDate?: number
  }>,
): Promise<Bank> {
  const { data } = await api.patch<Bank>(`/banks/${id}`, payload)
  return data
}

export async function deleteBank(id: string): Promise<void> {
  await api.delete(`/banks/${id}`)
}

/** Uma fatura afetada pela mudança de ciclo, com antes e depois. */
export interface BillingConfigInvoiceChange {
  invoiceId: string
  year: number
  month: number
  closeDate: { before: string; after: string }
  dueDate: { before: string; after: string }
  status: { before: InvoiceStatus; after: InvoiceStatus }
  /** `true` quando a nova data já tira a fatura de aberta. */
  statusChanged: boolean
}

/**
 * Impacto de alterar o ciclo de faturamento.
 *
 * Espelha `BillingConfigPreview` do backend. Só faturas EM ABERTO entram:
 * fechadas, em atraso e pagas têm datas históricas e não se movem.
 */
export interface BillingConfigPreview {
  /** `true` quando o ciclo não muda — não abrir confirmação. */
  scheduleUnchanged: boolean
  affectedCount: number
  statusChangeCount: number
  pendingReceivables: number
  changes: BillingConfigInvoiceChange[]
}

export async function previewBillingConfig(
  id: string,
  payload: Partial<{
    invoiceDueDate: number
    invoiceDueDaysAfterClose: number
  }>,
): Promise<BillingConfigPreview> {
  const { data } = await api.post<BillingConfigPreview>(
    `/banks/${id}/preview-billing-config`,
    payload,
  )
  return data
}

/**
 * Arquivar e restaurar são ações de domínio, não um PATCH em `isArchived`.
 *
 * O campo nem existe no DTO de update do backend: sob `whitelist: true` ele
 * seria descartado em silêncio. As guardas (banco de sistema, assinaturas
 * ativas) vivem nestes endpoints, e é por eles que a mudança de estado passa.
 */
export async function archiveBank(id: string): Promise<Bank> {
  const { data } = await api.post<Bank>(`/banks/${id}/archive`)
  return data
}

export async function restoreBank(id: string): Promise<Bank> {
  const { data } = await api.post<Bank>(`/banks/${id}/restore`)
  return data
}
