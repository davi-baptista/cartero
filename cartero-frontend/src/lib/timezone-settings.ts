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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Equivalência operacional entre timezones (TZ V1.2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Problema real observado: conta `America/Fortaleza`, device
 * `America/Sao_Paulo` — identificadores IANA diferentes, mas os dois nunca
 * observaram horário de verão desde que o Brasil aboliu DST (2019), e
 * Fortaleza nunca aplicou UTC-2 nem em nenhum registro histórico do tzdata
 * atual. O resultado é que os dois SEMPRE têm o mesmo offset, em qualquer
 * data — mostrar um aviso de mismatch nesse caso seria incomodar o usuário
 * por uma diferença que não existe na prática.
 *
 * Isto NÃO redefine identidade IANA (`America/Fortaleza !== America/Sao_Paulo`
 * continua verdadeiro em todo o resto do app) — é só uma regra de UX para
 * decidir se vale mostrar o aviso de sugestão de troca.
 *
 * Comparar só `offset(now)` FALHARIA para pares que têm o mesmo offset hoje
 * mas divergem por DST em outra época do ano (ex.: `Africa/Abidjan` — nunca
 * observa DST — vs `Atlantic/Azores` — observa: mesmo offset em setembro,
 * offsets diferentes em janeiro). Por isso o probe cobre um horizonte de 13
 * meses: `now` + o dia 1 de cada um dos 13 meses seguintes, sempre às 12:00Z
 * (horário estável, longe de qualquer transição de DST à meia-noite).
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
 * `timeZoneName: 'longOffset'` (`Intl.DateTimeFormat`, sempre disponível
 * onde `Intl.DateTimeFormat().resolvedOptions().timeZone` já funciona —
 * nunca depende de `Intl.supportedValuesOf`, indisponível no Hermes/Android
 * deste app).
 *
 * Offset zero formata como `"GMT"` puro, sem sufixo `+00:00` — tratado
 * explicitamente, senão o regex abaixo nunca casaria para UTC/GMT e a
 * comparação lançaria em vez de comparar corretamente.
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
  now: Date = new Date(),
): MismatchDecision {
  if (!device || !account || device === account) return { show: false }

  /*
    Equivalência operacional (TZ V1.2) — checada ANTES de qualquer ack. Um
    par equivalente nunca grava reconhecimento: se uma futura atualização do
    tzdata fizer as regras divergirem, o mesmo par volta a ser avaliado do
    zero, em vez de ficar preso a um ack antigo que não faz mais sentido.
  */
  if (areTimeZonesOperationallyEquivalent(account, device, now)) return { show: false }

  const pairKey = `${account}->${device}`
  if (alreadyShownPairKey === pairKey) {
    return { show: true, mismatch: { account, device } }
  }

  if (hasAcknowledgedMismatch(userId, account, device)) return { show: false }

  acknowledgeMismatch(userId, account, device)
  return { show: true, mismatch: { account, device } }
}
