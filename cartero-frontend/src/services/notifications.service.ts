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
