import { Prisma } from '@prisma/client';
import { financialCompetence } from './financial-timezone.helper';
import { requireAccountTimeZone } from './timezone.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Resolução da renda mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A renda é recorrente e muda ao longo do tempo. Cada `SalaryHistory` é uma
 * ALTERAÇÃO que passa a valer a partir de uma competência e segue valendo até
 * a próxima — o usuário não recadastra o mesmo valor todo mês.
 *
 * Antes existia só `User.salary`, o valor atual, aplicado a qualquer mês:
 * mudar a renda hoje reescrevia a sobra e o percentual comprometido de todo o
 * histórico. Este resolver é a fonte única; Budget e Overview não devem
 * repetir a consulta.
 */

/** Competência mensal — inteiros, como em `Invoice`. */
export interface SalaryCompetence {
  year: number;
  month: number;
}

/**
 * Renda aplicável a um mês.
 *
 * `known: false` NÃO é o mesmo que `amount: 0`.
 *
 * Zero é uma renda legítima (alguém entre empregos). Desconhecido é ausência
 * de informação: acontece em meses anteriores à primeira entrada, porque a
 * migration deliberadamente não inventou histórico. A UI precisa distinguir os
 * dois — dizer "R$ 0,00" para um mês desconhecido afirma um fato falso.
 */
export type ResolvedSalary =
  | {
      known: true;
      amount: number;
      /** Competência da entrada que forneceu o valor. */
      effectiveFrom: SalaryCompetence;
    }
  | { known: false; amount: null; effectiveFrom: null };

export const UNKNOWN_SALARY: ResolvedSalary = {
  known: false,
  amount: null,
  effectiveFrom: null,
};

/** Ordena competências cronologicamente: negativo se `a` vem antes de `b`. */
export function compareCompetence(
  a: SalaryCompetence,
  b: SalaryCompetence,
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/**
 * A entrada aplicável a uma competência: a mais recente com
 * `(year, month) <= pedido`.
 *
 * O filtro é feito em SQL para não trazer o histórico inteiro a cada consulta
 * de orçamento. `year < pedido` OR (`year = pedido` AND `month <= pedido`)
 * expressa a comparação lexicográfica que o par de inteiros exige — um
 * `month <= 8` solto pegaria agosto de qualquer ano.
 */
export async function resolveSalaryForMonth(
  tx: Prisma.TransactionClient,
  userId: string,
  competence: SalaryCompetence,
): Promise<ResolvedSalary> {
  const entry = await tx.salaryHistory.findFirst({
    where: {
      userId,
      OR: [
        { year: { lt: competence.year } },
        { year: competence.year, month: { lte: competence.month } },
      ],
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { amount: true, year: true, month: true },
  });

  if (!entry) return UNKNOWN_SALARY;

  return {
    known: true,
    amount: Number(entry.amount),
    effectiveFrom: { year: entry.year, month: entry.month },
  };
}

/**
 * `true` quando a competência é o mês corrente.
 *
 * Decide se `User.salary` — o cache de "renda de hoje" — deve acompanhar a
 * alteração. Corrigir um mês passado ou agendar um aumento futuro não pode
 * mudar o valor exibido agora no perfil.
 *
 * O fuso é explícito porque o servidor roda em UTC: em 31/08 às 22h de
 * Fortaleza já é 01/09 em UTC, e `new Date().getMonth()` diria setembro.
 *
 * `timeZone` (TZ2): `null` preserva `currentCompetence` (Fortaleza fixa) —
 * comportamento legado exato, para toda conta anterior ao TZ1/TZ2.
 */
export function isCurrentCompetence(
  competence: SalaryCompetence,
  now: Date = new Date(),
  timeZone: string | null = null,
): boolean {
  const current = currentCompetence(now, timeZone);
  return competence.year === current.year && competence.month === current.month;
}

/**
 * Competência do mês corrente.
 *
 * `timeZone === null` é a authority LEGADA (Fortaleza fixa) — o
 * comportamento exato de toda conta anterior ao TZ1/TZ2.
 * `timeZone !== null` usa `financialCompetence` (TZ2), resolvendo pela
 * timezone real da conta.
 */
export function currentCompetence(
  now: Date = new Date(),
  timeZone: string | null | undefined = undefined,
): SalaryCompetence {
  return financialCompetence(
    now,
    requireAccountTimeZone(timeZone, 'salary account timezone'),
  );
}

/** Valida uma competência recebida da API. */
export function isValidCompetence(competence: SalaryCompetence): boolean {
  return (
    Number.isInteger(competence.year) &&
    Number.isInteger(competence.month) &&
    competence.month >= 1 &&
    competence.month <= 12 &&
    competence.year >= 2000 &&
    competence.year <= 2100
  );
}
