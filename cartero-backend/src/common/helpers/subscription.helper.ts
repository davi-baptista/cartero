/**
 * Um ciclo de assinatura é identificado por "YYYY-MM" — o mês de competência,
 * não a data em que a cobrança caiu. Essa distinção é o que impede que uma
 * assinatura no dia 31 escorregue de fatura em fatura.
 */
export type Cycle = { year: number; month: number };

const CYCLE_RE = /^(\d{4})-(\d{2})$/;

export function parseCycle(value: string): Cycle {
  const match = CYCLE_RE.exec(value);
  if (!match) {
    throw new Error(`Ciclo inválido: "${value}" (esperado "YYYY-MM")`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Ciclo inválido: mês ${month} fora de 1-12`);
  }
  return { year, month };
}

export function formatCycle({ year, month }: Cycle): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function currentCycle(now: Date = new Date()): Cycle {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function addCycles({ year, month }: Cycle, delta: number): Cycle {
  const zeroBased = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

/** Negativo se `a` vem antes de `b`; zero se são o mesmo ciclo. */
export function compareCycles(a: Cycle, b: Cycle): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Data da cobrança dentro do ciclo. Meses curtos recebem o último dia — o dia
 * original nunca é reescrito, senão uma assinatura no 31 viraria 28 depois de
 * fevereiro e andaria para trás de forma permanente.
 */
export function chargeDateForCycle(
  { year, month }: Cycle,
  dayOfMonth: number,
): Date {
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Ciclos que ainda faltam gerar, do mais antigo ao mais recente.
 *
 * `lastGeneratedFor` sozinho responde isso: não é preciso varrer as
 * transações já criadas. Um ciclo do mês corrente só entra depois que o dia
 * da cobrança chegou — antes disso a assinatura ainda não venceu.
 */
export function pendingCycles(
  startedAt: string,
  lastGeneratedFor: string | null,
  dayOfMonth: number,
  now: Date = new Date(),
): Cycle[] {
  const start = lastGeneratedFor
    ? addCycles(parseCycle(lastGeneratedFor), 1)
    : parseCycle(startedAt);

  const cycles: Cycle[] = [];
  const today = currentCycle(now);

  for (
    let cycle = start;
    compareCycles(cycle, today) <= 0;
    cycle = addCycles(cycle, 1)
  ) {
    // O ciclo corrente só vence quando o dia da cobrança chega.
    if (compareCycles(cycle, today) === 0) {
      const charge = chargeDateForCycle(cycle, dayOfMonth);
      const todayUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      if (charge > todayUtc) break;
    }
    cycles.push(cycle);
  }

  return cycles;
}
