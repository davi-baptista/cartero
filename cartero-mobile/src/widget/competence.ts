/**
 * A competência civil corrente do Cartero.
 *
 * ── Por que não `new Date().getMonth()` ──
 *
 * Esse método lê o fuso do APARELHO. Um usuário que atravessa o Atlântico
 * passaria a ver outro mês no widget — e a competência financeira do Cartero
 * não muda porque alguém viajou. O mês de uma fatura é um fato do produto,
 * não do lugar onde o telefone está.
 *
 * O Cartero opera em America/Fortaleza (UTC−3, sem horário de verão), e é
 * esse o fuso que decide quando setembro vira outubro. A diferença aparece
 * todo fim de mês: às 23h30 do dia 30 em Fortaleza já é dia 1º em UTC, e um
 * cálculo ingênuo mostraria a competência seguinte por três horas.
 */

/**
 * Fuso do Cartero.
 *
 * `Intl` resolve a conversão — inclusive a aritmética de virada de dia, mês e
 * ano — sem precisar somar offsets à mão. Subtrair três horas manualmente
 * funcionaria hoje e passaria a mentir se a regra de fuso mudasse.
 */

export interface Competence {
  /** 1–12, como o backend espera em `GET /budget?month=`. */
  month: number
  year: number
}

function competenceFromParts(parts: Intl.DateTimeFormatPart[]): Competence {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  return { month: get('month'), year: get('year') }
}

/**
 * A competência que o Cartero considera corrente no instante dado.
 *
 * ── TZ4: dois caminhos explícitos, nunca um fallback escondido ──
 *
 * `timeZone` vem de `AuthUser.timeZone` (TZ1). `null` é conta legada — usa o
 * caminho HISTÓRICO do Cartero, fixo em `CARTERO_TIME_ZONE`, byte a byte
 * igual ao que sempre foi. Só contas com timezone configurada passam a
 * resolver a competência pela SUA própria timezone (IANA, via `Intl`).
 *
 * Nunca `timeZone ?? CARTERO_TIME_ZONE`: essa forma apagaria a distinção
 * entre "conta com timezone" e "legado", que precisa ficar visível em quem
 * chama — a mesma exigência arquitetural do backend (TZ2) e do Web (TZ3).
 *
 * `now` é injetável porque um teste que dependa do relógio real não consegue
 * exercitar a virada de mês — e é exatamente aí que o cálculo ingênuo falha.
 */
export function currentCarteroCompetence(
  now: Date = new Date(),
  timeZone: string | null | undefined = undefined,
): Competence {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new Error('Missing account timezone')
  }

  const accountFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return competenceFromParts(accountFormatter.formatToParts(now))
}
