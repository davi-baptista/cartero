import { api } from '@/lib/api'
import type { Transaction, TransactionFilters, TransactionType, InstallmentScope } from '@/types'

function normalizeTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    amount: Number(transaction.amount),
  }
}

function normalizeTransactionResponse(
  data: Transaction | Transaction[],
): Transaction | Transaction[] {
  return Array.isArray(data) ? data.map(normalizeTransaction) : normalizeTransaction(data)
}

export async function getTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
  const { data } = await api.get<Transaction[]>('/transactions', { params: filters })
  return data.map(normalizeTransaction)
}

/** Fatura que vai receber uma parcela — existente ou ainda a ser criada. */
export interface PreviewInvoice {
  year: number
  month: number
  dueDate: string | null
  closeDate: string | null
  status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE' | null
  exists: boolean
}

export interface PreviewInstallment {
  number: number
  of: number
  amount: number
  title: string
  invoice: PreviewInvoice | null
}

/**
 * Consequências de uma criação, calculadas pelo servidor.
 *
 * O rateio das parcelas, a competência das faturas e o vencimento das
 * cobranças vêm daqui — o frontend não recalcula nada disso.
 */
export interface TransactionPreview {
  type: TransactionType
  isRefund: boolean
  totalAmount: number
  installmentCount: number
  affectsInvoice: boolean
  installments: PreviewInstallment[]
  receivables: {
    personId: string
    personName: string
    total: number
    count: number
    items: Array<{ number: number; amount: number; dueDate: string | null }>
  } | null
  /** Preenchido quando o estado atual já garante que o save será recusado. */
  blocked: { code: string; message: string } | null
}

export interface PreviewTransactionPayload {
  bankId: string
  title: string
  type: TransactionType
  /** VALOR TOTAL da compra — o servidor divide entre as parcelas. */
  amount: number
  date: string
  installments?: number
  isRefund?: boolean
  personId?: string
}

export async function previewTransaction(
  payload: PreviewTransactionPayload,
): Promise<TransactionPreview> {
  const { data } = await api.post<TransactionPreview>(
    '/transactions/preview',
    payload,
  )
  return data
}

/** Um valor antes e depois, quando ele muda. */
export interface PreviewChange<T> {
  before: T
  after: T
}

export interface UpdatePreviewInvoiceChange {
  installmentNumber: number | null
  from: { year: number; month: number } | null
  to: { year: number; month: number } | null
  dueDate: PreviewChange<string | null>
}

/**
 * Impacto projetado de uma edição — espelha `TransactionUpdatePreview` do
 * backend. Campos `null` significam "este aspecto não muda", e a interface
 * deve omiti-los em vez de mostrar "sem alteração".
 */
export interface TransactionUpdatePreview {
  affectedCount: number
  descriptiveOnly: boolean
  scope: InstallmentScope
  /** `true` quando a regra impôs o escopo (editar a data força ALL). */
  scopeForced: boolean
  amountPerInstallment: PreviewChange<number> | null
  affectedTotal: PreviewChange<number> | null
  seriesTotal: PreviewChange<number> | null
  invoiceChanges: UpdatePreviewInvoiceChange[]
  person: {
    before: { id: string; name: string } | null
    after: { id: string; name: string } | null
    receivablesCreated: number
    receivablesUpdated: number
    receivablesRemoved: number
  } | null
  /** O save vai recusar — não ofereça confirmação. */
  blocked: { code: string; message: string } | null
  /** Possível, mas exige confirmação explícita. */
  requiresConfirmation: { code: string; message: string } | null
}

export interface PreviewUpdatePayload {
  bankId?: string
  categoryId?: string
  type?: TransactionType
  title?: string
  amount?: number
  isRefund?: boolean
  date?: string
  description?: string
  personId?: string | null
  scope?: InstallmentScope
}

export async function previewUpdateTransaction(
  id: string,
  payload: PreviewUpdatePayload,
): Promise<TransactionUpdatePreview> {
  const { data } = await api.post<TransactionUpdatePreview>(
    `/transactions/${id}/preview-update`,
    payload,
  )
  return data
}

export async function getTransaction(id: string): Promise<Transaction> {
  const { data } = await api.get<Transaction>(`/transactions/${id}`)
  return normalizeTransaction(data)
}

export async function createTransaction(payload: {
  bankId: string
  categoryId: string
  type: TransactionType
  title: string
  amount: number
  isRefund?: boolean
  date: string
  description?: string
  installments?: number
  personId?: string
}): Promise<Transaction | Transaction[]> {
  const { data } = await api.post<Transaction | Transaction[]>('/transactions', payload)
  return normalizeTransactionResponse(data)
}

export async function updateTransaction(
  id: string,
  payload: Partial<{
    bankId: string
    categoryId: string
    type: TransactionType
    title: string
    amount: number
    isRefund?: boolean
    date: string
    description: string
    personId: string | null
    confirmReopenClosedInvoice: boolean
  }>,
  scope?: InstallmentScope,
): Promise<Transaction | Transaction[]> {
  const { data } = await api.patch<Transaction | Transaction[]>(
    `/transactions/${id}`,
    payload,
    { params: scope ? { scope } : undefined },
  )
  return normalizeTransactionResponse(data)
}

export async function deleteTransaction(id: string, scope?: InstallmentScope): Promise<void> {
  await api.delete(`/transactions/${id}`, {
    params: scope ? { scope } : undefined,
  })
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Excluir as parcelas em aberto de uma compra parcelada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O servidor é a autoridade sobre o que pode sair. O cliente não repete
 * `invoice.status === 'PAID'` nem consulta cobranças: ele pergunta, mostra a
 * resposta e devolve exatamente o conjunto que o usuário confirmou.
 */

/** Por que uma parcela sobrevive à exclusão. */
export type InstallmentPreservationReason =
  | 'PAID_INVOICE'
  | 'RECEIVABLE_ALREADY_PAID'
  | 'PAYMENT_TRANSACTION_LINKED'

export interface DeletePreviewInstallment {
  id: string
  /** Posição original na série (`7` em "7/10"). Nunca recalculada. */
  installmentNumber: number | null
  amount: number
  date: string
}

export interface DeletePreviewPreserved extends DeletePreviewInstallment {
  reason: InstallmentPreservationReason
  message: string
}

export interface TransactionDeletePreview {
  /** `false` para compra à vista — a tela usa a confirmação simples. */
  isInstallment: boolean
  seriesTotal: number
  deletableCount: number
  preservedCount: number
  /** Soma real das deletáveis, não valor × quantidade. */
  deletableTotal: number
  deletable: DeletePreviewInstallment[]
  preserved: DeletePreviewPreserved[]
  receivablesRemoved: number
  invoicesEmptied: number
}

/** O que a execução de fato removeu — não o que a prévia previa. */
export interface TransactionDeleteResult {
  deletedIds: string[]
  deletedCount: number
  preservedIds: string[]
  receivablesRemoved: number
  invoicesEmptied: number
}

export async function previewDeleteTransaction(
  id: string,
): Promise<TransactionDeletePreview> {
  const { data } = await api.post<TransactionDeletePreview>(
    `/transactions/${id}/preview-delete`,
  )
  return data
}

/**
 * Executa a exclusão das parcelas em aberto.
 *
 * `expectedDeletableIds` são os ids que o usuário viu na prévia. Mandar a
 * contagem não bastaria: trocar uma parcela por outra mantém o total e mudaria
 * o que é apagado. Se o conjunto tiver mudado, o servidor recusa com
 * `DELETE_SET_CHANGED` em vez de executar algo diferente do confirmado.
 */
export async function deleteOpenInstallments(
  id: string,
  expectedDeletableIds: string[],
): Promise<TransactionDeleteResult> {
  const { data } = await api.delete<TransactionDeleteResult>(
    `/transactions/${id}`,
    {
      params: { scope: 'OPEN' },
      data: { expectedDeletableIds },
    },
  )
  return data
}
