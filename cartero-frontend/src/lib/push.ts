/**
 * `navigator.brave.isBrave()` é a autoridade que o próprio Brave expõe — uma
 * Promise que resolve `true` apenas nele. Preferível a farejar o user agent,
 * que o Brave deliberadamente disfarça como Chrome.
 *
 * A tipagem é local e estreita: declarar `brave` no `Navigator` global faria o
 * campo parecer disponível em todo o app, quando só este módulo o consulta.
 */
type BraveNavigator = Navigator & {
  brave?: { isBrave?: () => Promise<boolean> }
}

export async function isBraveBrowser(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false

  const candidate = (navigator as BraveNavigator).brave
  if (typeof candidate?.isBrave !== 'function') return false

  try {
    return await candidate.isBrave()
  } catch {
    // A detecção é só para escolher a mensagem — falhar aqui nunca pode
    // impedir o fluxo de ativação.
    return false
  }
}

export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i)
  }
  return bytes
}

export async function enablePushNotifications(
  publicKey: string,
  /**
   * Descarta a inscrição local antes de criar outra.
   *
   * Usado quando o backend não reconhece o endpoint local: reaproveitá-lo
   * devolveria exatamente o endpoint que pode ter sido invalidado por um
   * `404/410`, e o registro voltaria a apontar para um destino morto.
   */
  options: { forceFresh?: boolean } = {},
): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('Notificações push não são suportadas neste navegador')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Permissão de notificação negada')
  }

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()

  if (existing) {
    if (!options.forceFresh) return existing
    await existing.unsubscribe()
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
}

/**
 * Desfaz uma inscrição recém-criada que o backend não conseguiu registrar.
 *
 * Sem isso o browser fica com inscrição e o servidor sem linha: na visita
 * seguinte o toggle leria "local presente" e — antes da verificação de
 * backend — exibiria ON sem nenhum push podendo chegar. É o half-enabled
 * silencioso.
 */
export async function rollbackPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  try {
    await subscription.unsubscribe()
  } catch {
    // O estado da UI já converge para OFF pela verificação de backend; falhar
    // aqui não pode transformar um erro de registro em exceção não tratada.
  }
}

export async function disablePushNotifications(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return null

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}
