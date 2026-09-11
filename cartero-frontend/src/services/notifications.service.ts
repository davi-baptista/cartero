import { api } from '@/lib/api'

export async function getPublicKey(): Promise<string> {
  const { data } = await api.get<{ publicKey: string }>('/notifications/public-key')
  return data.publicKey
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await api.post('/notifications/subscribe', {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  })
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await api.delete('/notifications/subscribe', { data: { endpoint } })
}

/**
 * "Este endpoint está registrado para o usuário atual?"
 *
 * POST porque o endpoint vai no BODY: em query string ele acabaria em access
 * log, histórico e proxy. A resposta é só o booleano — nenhuma chave volta.
 */
export async function getSubscriptionStatus(endpoint: string): Promise<boolean> {
  const { data } = await api.post<{ registered: boolean }>(
    '/notifications/subscription-status',
    { endpoint },
  )
  return data.registered
}
