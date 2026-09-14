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
export const CARTERO_TIME_ZONE = 'America/Fortaleza'

export interface Competence {
  /** 1–12, como o backend espera em `GET /budget?month=`. */
  month: number
  year: number
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CARTERO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * A competência que o Cartero considera corrente no instante dado.
 *
 * `now` é injetável porque um teste que dependa do relógio real não consegue
 * exercitar a virada de mês — e é exatamente aí que o cálculo ingênuo falha.
 */
export function currentCarteroCompetence(now: Date = new Date()): Competence {
  const parts = formatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  return { month: get('month'), year: get('year') }
}
