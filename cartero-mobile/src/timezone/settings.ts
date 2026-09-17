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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Equivalência operacional entre timezones (TZ V1.2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Mesma regra e mesmos testes do app Web (`cartero-frontend/src/lib/
 * timezone-settings.ts`) — não pode existir uma versão mais permissiva no
 * Web e outra mais estrita no Mobile para o mesmo par de timezones.
 *
 * Problema real observado: conta `America/Fortaleza`, device
 * `America/Sao_Paulo` — identificadores IANA diferentes, mas os dois nunca
 * observaram horário de verão desde que o Brasil aboliu DST (2019), e
 * Fortaleza nunca aplicou UTC-2 em nenhum registro histórico do tzdata
 * atual. O resultado é que os dois SEMPRE têm o mesmo offset, em qualquer
 * data — mostrar um aviso de mismatch nesse caso seria incomodar o usuário
 * por uma diferença que não existe na prática.
 *
 * Isto NÃO redefine identidade IANA — é só uma regra de UX para decidir se
 * vale mostrar o aviso de sugestão de troca.
 *
 * Comparar só `offset(now)` FALHARIA para pares que têm o mesmo offset hoje
 * mas divergem por DST em outra época do ano (ex.: `Africa/Abidjan` — nunca
 * observa DST — vs `Atlantic/Azores` — observa: mesmo offset em setembro,
 * offsets diferentes em janeiro). Por isso o probe cobre um horizonte de 13
 * meses: `now` + o dia 1 de cada um dos 13 meses seguintes, sempre às 12:00Z.
 */
export function areTimeZonesOperationallyEquivalent(
  accountTimeZone: string,
  deviceTimeZone: string,
  now: Date,
): boolean {
  if (accountTimeZone === deviceTimeZone) return true

  for (const probeDate of operationalEquivalenceProbeDates(now)) {
    if (utcOffsetMinutes(probeDate, accountTimeZone) !== utcOffsetMinutes(probeDate, deviceTimeZone)) {
      return false
    }
  }
  return true
}

function operationalEquivalenceProbeDates(now: Date): Date[] {
  const dates = [now]
  for (let monthsAhead = 0; monthsAhead < 13; monthsAhead++) {
    dates.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1, 12, 0, 0)),
    )
  }
  return dates
}

/**
 * Offset UTC (em minutos) de `timeZone` no instante `instant`, via
 * `timeZoneName: 'longOffset'` — mesma técnica de `resolveDeviceTimeZone`,
 * nunca depende de `Intl.supportedValuesOf` (indisponível neste Hermes).
 *
 * Offset zero formata como `"GMT"` puro, sem sufixo `+00:00` — tratado
 * explicitamente.
 */
function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value

  if (formatted === 'GMT') return 0

  const match = formatted?.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`Unable to parse UTC offset for ${timeZone}: ${formatted}`)

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
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
