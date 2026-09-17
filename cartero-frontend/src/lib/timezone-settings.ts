export function supportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

export function resolveDeviceTimeZone(): string | null {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone
    return value && supportedTimeZones().includes(value) ? value : null
  } catch {
    return null
  }
}

export function isSupportedTimeZone(value: string): boolean {
  return supportedTimeZones().includes(value)
}

export function mismatchKey(userId: string, account: string, device: string) {
  return `cartero.timezone-mismatch.v1:${userId}:${account}->${device}`
}

export function hasAcknowledgedMismatch(userId: string, account: string, device: string) {
  try {
    return localStorage.getItem(mismatchKey(userId, account, device)) === '1'
  } catch {
    return false
  }
}

export function acknowledgeMismatch(userId: string, account: string, device: string) {
  try {
    localStorage.setItem(mismatchKey(userId, account, device), '1')
  } catch {
    // Local storage is an optimization; it must not change financial state.
  }
}

export type MismatchDecision =
  | { show: false }
  | { show: true; mismatch: { account: string; device: string } }

/**
 * Decide se o aviso de mismatch deve aparecer, e reconhece o par
 * account/device na mesma chamada quando a resposta é `show: true`.
 *
 * `alreadyShownPairKey` existe para tornar esta função segura sob o
 * Strict Mode do React (dev only): o efeito que a chama roda duas vezes em
 * sequência (mount→cleanup→mount), e sem esse guard a segunda chamada
 * encontraria o ack já gravado pela primeira e devolveria `show: false` —
 * o aviso nunca ficaria visível, mesmo sendo o comportamento correto de
 * produção (onde o efeito roda uma vez só). Passar o par já decidido nesta
 * montagem lógica faz a segunda chamada reconhecer "já decidi isto agora" em
 * vez de desfazer a própria decisão.
 */
export function resolveMismatchDecision(
  userId: string,
  account: string | null | undefined,
  device: string | null,
  alreadyShownPairKey: string | null,
): MismatchDecision {
  if (!device || !account || device === account) return { show: false }

  const pairKey = `${account}->${device}`
  if (alreadyShownPairKey === pairKey) {
    return { show: true, mismatch: { account, device } }
  }

  if (hasAcknowledgedMismatch(userId, account, device)) return { show: false }

  acknowledgeMismatch(userId, account, device)
  return { show: true, mismatch: { account, device } }
}
