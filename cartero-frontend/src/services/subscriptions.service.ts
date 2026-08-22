import { api } from '@/lib/api'
import type {
  GenerationPlanItem,
  Subscription,
  SubscriptionCreateResult,
  SubscriptionRunResult,
  TransactionType,
} from '@/types'

export async function getSubscriptions(): Promise<Subscription[]> {
  const { data } = await api.get<Subscription[]>('/subscriptions')
  return data
}

export interface CreateSubscriptionPayload {
  title: string
  bankId: string
  /** Omitida cai na categoria de sistema "Assinatura". */
  categoryId?: string
  /**
   * Chave desta TENTATIVA de criação.
   *
   * Reenviar o mesmo POST com a mesma chave devolve a MESMA assinatura em vez
   * de criar outra. Não identifica a assinatura — duas "Netflix" idênticas são
   * cadastro legítimo; identifica a tentativa.
   */
  creationKey?: string
  type: TransactionType
  amount: number
  description?: string
  dayOfMonth: number
  startedAt: string
}

export async function createSubscription(
  payload: CreateSubscriptionPayload,
): Promise<SubscriptionCreateResult> {
  const { data } = await api.post<SubscriptionCreateResult>(
    '/subscriptions',
    payload,
  )
  return data
}

/** `startedAt` não entra: é imutável depois de criada. */
export async function updateSubscription(
  id: string,
  payload: Partial<Omit<CreateSubscriptionPayload, 'startedAt'> & { isActive: boolean }>,
): Promise<Subscription> {
  const { data } = await api.patch<Subscription>(`/subscriptions/${id}`, payload)
  return data
}

export async function deleteSubscription(id: string): Promise<void> {
  await api.delete(`/subscriptions/${id}`)
}

/** Simula a geração sem criar nada — alimenta o aviso de início retroativo. */
export async function previewSubscription(params: {
  bankId: string
  dayOfMonth: number
  startedAt: string
  type: TransactionType
}): Promise<GenerationPlanItem[]> {
  const { data } = await api.get<GenerationPlanItem[]>('/subscriptions/preview', { params })
  return data
}

/**
 * Rede de segurança: gera o que ficou pendente desde a última visita.
 *
 * O cron diário é o caminho principal; isto cobre o intervalo em que o
 * servidor esteve hibernando. Cada assinatura vem com o seu resultado — uma
 * que falhe não impede as demais, e a falha é reportada em vez de sumir.
 */
export async function runSubscriptions(): Promise<SubscriptionRunResult[]> {
  const { data } = await api.post<SubscriptionRunResult[]>('/subscriptions/run')
  return data
}
