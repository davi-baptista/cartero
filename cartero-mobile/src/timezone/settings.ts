import { IANA_TIME_ZONES } from './iana-zones'

export type TimezoneMismatch = { account: string; device: string }

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Duas responsabilidades separadas (TZ V1.1)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "detectar QUAL é o timezone atual do dispositivo" e "enumerar TODOS os
 * timezones selecionáveis" são autoridades diferentes, e não podem depender
 * da mesma API. `Intl.supportedValuesOf('timeZone')` não existe neste
 * runtime Hermes/Android (`typeof === 'undefined'`, confirmado em runtime
 * real, não lança) — enumerar por ela sempre devolveria lista vazia, mas
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` funciona normalmente
 * (confirmado devolvendo o valor correto do sistema, ex.: `America/Fortaleza`
 * após configurado). Por isso:
 *
 * - `supportedTimeZones()` enumera a partir da lista ESTÁTICA
 *   (`iana-zones.ts`, commitada com o app, gerada no mesmo runtime Node que o
 *   backend usa para validar) — nunca depende de `supportedValuesOf`.
 * - `resolveDeviceTimeZone()` detecta via `resolvedOptions().timeZone` —
 *   nunca precisa que a enumeração exista para funcionar; só usa a lista
 *   estática para confirmar que o valor devolvido é um IANA reconhecido
 *   (nunca aceita literalmente qualquer string, incluindo o caso hostil de
 *   `resolvedOptions()` devolver um valor fora do conjunto conhecido).
 */
export function supportedTimeZones(): string[] {
  return IANA_TIME_ZONES as string[]
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

export interface TimezoneAcknowledgementStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/**
 * `expo-secure-store` só aceita chaves em `[A-Za-z0-9._-]` — `:`, `/` e `>`
 * (usados na versão anterior desta chave) fazem `SecureStore.getItemAsync`
 * rejeitar a leitura com `Error: Invalid key provided to SecureStore`
 * (confirmado em runtime real, AVD `Cartero_API_36`: o mismatch nunca havia
 * chegado a esta chamada antes por causa do bug separado do
 * `Intl.supportedValuesOf`, que sempre fazia `resolveDeviceTimeZone()`
 * devolver `null` e a checagem retornar cedo — corrigir aquele bug expôs
 * este). Identificadores IANA nunca contêm `.` (confirmado contra as 417
 * zonas do contrato do backend), então trocar `/` por `.` é uma bijeção
 * segura sem risco de colisão; `:` e `->` também viram `.`, únicos
 * separadores de segmento usados aqui.
 */
export function mismatchKey(userId: string, account: string, device: string) {
  const safe = (value: string) => value.replace(/\//g, '.')
  return `cartero.timezone-mismatch.v1.${safe(userId)}.${safe(account)}-to-${safe(device)}`
}

export async function acknowledgeOnce(
  store: TimezoneAcknowledgementStore,
  userId: string,
  account: string,
  device: string,
): Promise<boolean> {
  const key = mismatchKey(userId, account, device)
  if ((await store.get(key)) === '1') return false
  await store.set(key, '1')
  return true
}
