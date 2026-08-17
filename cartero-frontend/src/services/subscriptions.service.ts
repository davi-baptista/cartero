import { api } from '@/lib/api'
import type { GenerationPlanItem, Subscription, TransactionType } from '@/types'

export async function getSubscriptions(): Promise<Subscription[]> {
  const { data } = await api.get<Subscription[]>('/subscriptions')
  return data
}

export interface CreateSubscriptionPayload {
  title: string
  bankId: string
  type: TransactionType
  amount: number
  description?: string
  dayOfMonth: number
  startedAt: string
}

export async function createSubscription(
  payload: CreateSubscriptionPayload,
): Promise<Subscription & { generated: GenerationPlanItem[] }> {
  const { data } = await api.post<Subscription & { generated: GenerationPlanItem[] }>(
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

/** Rede de segurança: gera o que ficou pendente desde a última visita. */
export async function runSubscriptions(): Promise<
  Array<{ subscriptionId: string; generated: GenerationPlanItem[] }>
> {
  const { data } = await api.post('/subscriptions/run')
  return data
}
