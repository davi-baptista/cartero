/**
 * ══════════════════════════════════════════════════════════════════════════
 * Authority do "hoje financeiro" por conta (TZ2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `civilDay` (`date-only.helper.ts`) responde "hoje" fixando Fortaleza
 * (`-3h` hardcoded) para TODA conta — a authority legada, que continua sendo
 * o comportamento correto para `user.timeZone === null`. Este módulo
 * responde a MESMA pergunta ("hoje", "que dia é este instante"), mas para
 * contas que têm uma timezone financeira explícita (`User.timeZone`, IANA,
 * validada/canonicalizada em TZ1).
 *
 * Nunca aceita `timeZone` ausente/nula silenciosamente: cada domínio decide
 * explicitamente, no call site, se usa esta authority (`timeZone != null`)
 * ou a legada (`civilDay`, quando `timeZone === null`). Não existe fallback
 * escondido do tipo `timeZone ?? 'America/Fortaleza'` — isso reintroduziria
 * exatamente o hardcode que TZ1/TZ2 existem para sair de baixo, só que
 * disfarçado de "resolução automática".
 *
 * Implementação via `Intl.DateTimeFormat` com `timeZone` explícito — nunca
 * offset fixo, nunca `process.env.TZ`. `Intl` resolve corretamente virada de
 * dia, mudança de mês/ano e transições de horário de verão (testado com
 * Europe/Lisbon), porque consulta a base de regras IANA do runtime, não faz
 * aritmética de deslocamento fixo.
 */

export interface FinancialCivilParts {
  year: number
  month: number
  day: number
}

/**
 * Componentes (ano/mês/dia) do dia civil de `instant`, na timezone dada.
 *
 * `timeZone` precisa ser um identificador IANA já validado (ex.: via
 * `resolveIanaTimeZone`, TZ1) — esta função não valida, para não duplicar
 * essa responsabilidade. Um valor inválido lança (comportamento do
 * `Intl.DateTimeFormat` nativo), não falha em silêncio.
 */
export function financialCivilParts(
  instant: Date,
  timeZone: string,
): FinancialCivilParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * O dia civil de `instant` na timezone dada, como `YYYY-MM-DD`.
 *
 * Equivalente ao propósito de `civilDay` (`date-only.helper.ts`), mas
 * parametrizado pela timezone da conta em vez de fixar Fortaleza.
 */
export function financialCivilDay(instant: Date, timeZone: string): string {
  const { year, month, day } = financialCivilParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Competência (ano/mês) de `instant` na timezone dada. */
export interface FinancialCompetence {
  year: number
  month: number
}

export function financialCompetence(
  instant: Date,
  timeZone: string,
): FinancialCompetence {
  const { year, month } = financialCivilParts(instant, timeZone);
  return { year, month };
}
