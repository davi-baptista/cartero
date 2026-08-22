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

/** Meia-noite UTC do dia de `now` — a unidade em que ciclos são comparados. */
function toCivilDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Primeiro ciclo que uma reativação pode gerar.
 *
 * A regra de produto: reativar não cria cobrança retroativa. Se o dia da
 * cobrança do mês corrente ainda não passou, esse mês conta; se já passou, o
 * primeiro é o mês seguinte. Reativar EXATAMENTE no dia da cobrança conta o
 * mês corrente — o dia da cobrança pertence ao ciclo que cobra nele, a mesma
 * convenção que `pendingCycles` usa para o ciclo corrente.
 *
 * A comparação é por DIA CIVIL: o horário da reativação não pode decidir se
 * uma cobrança acontece.
 */
export function resumeCycle(dayOfMonth: number, now: Date = new Date()): Cycle {
  const today = currentCycle(now);
  const charge = chargeDateForCycle(today, dayOfMonth);

  // `>=` porque o dia da cobrança ainda conta: reativar em 20/08 com cobrança
  // no dia 20 inclui agosto. Só o dia seguinte empurra para o mês que vem.
  return charge >= toCivilDay(now) ? today : addCycles(today, 1);
}

/**
 * Ciclos que ainda faltam gerar, do mais antigo ao mais recente.
 *
 * `lastGeneratedFor` responde a idempotência: não é preciso varrer as
 * transações já criadas. Um ciclo do mês corrente só entra depois que o dia
 * da cobrança chegou — antes disso a assinatura ainda não venceu.
 *
 * `activeSince` responde a pausa. Sem ele, um mês pendente porque o cron
 * ficou fora do ar era indistinguível de um mês em que a assinatura estava
 * pausada, e reativar depois de três meses gerava as três cobranças. O marco
 * corta os ciclos anteriores à ativação atual; nulo significa "sem restrição",
 * o comportamento de quem nunca foi pausada.
 */
export function pendingCycles(
  startedAt: string,
  lastGeneratedFor: string | null,
  dayOfMonth: number,
  now: Date = new Date(),
  activeSince: string | null = null,
): Cycle[] {
  const afterLastGenerated = lastGeneratedFor
    ? addCycles(parseCycle(lastGeneratedFor), 1)
    : parseCycle(startedAt);

  // O mais restritivo dos dois vence: o marco de ativação nunca faz voltar
  // atrás de um ciclo já gerado, e `lastGeneratedFor` nunca ressuscita um
  // ciclo que a pausa descartou.
  const resumeFloor = activeSince ? parseCycle(activeSince) : null;
  const start =
    resumeFloor && compareCycles(resumeFloor, afterLastGenerated) > 0
      ? resumeFloor
      : afterLastGenerated;

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
      if (charge > toCivilDay(now)) break;
    }
    cycles.push(cycle);
  }

  return cycles;
}

/**
 * Próxima cobrança de uma assinatura ativa, ou `null` se pausada.
 *
 * Fonte única para a interface: calcular isso no frontend criaria um segundo
 * algoritmo, que divergiria da geração real. Devolve a data do primeiro ciclo
 * que ainda vai gerar — se há ciclo pendente, é o dele; senão, o do ciclo
 * seguinte ao último gerado.
 */
export function nextChargeDate(
  subscription: {
    startedAt: string;
    lastGeneratedFor: string | null;
    activeSince: string | null;
    dayOfMonth: number;
    isActive: boolean;
  },
  now: Date = new Date(),
): Date | null {
  if (!subscription.isActive) return null;

  const pending = pendingCycles(
    subscription.startedAt,
    subscription.lastGeneratedFor,
    subscription.dayOfMonth,
    now,
    subscription.activeSince,
  );

  // Ciclo pendente é cobrança que já venceu e ainda não foi gerada; é ela que
  // o usuário vê acontecer a seguir.
  if (pending.length > 0) {
    return chargeDateForCycle(pending[0], subscription.dayOfMonth);
  }

  const today = currentCycle(now);
  const chargeThisMonth = chargeDateForCycle(today, subscription.dayOfMonth);

  // Nada pendente e o dia ainda não chegou: a cobrança deste mês é a próxima,
  // desde que a ativação atual já a alcance.
  const floor = subscription.activeSince
    ? parseCycle(subscription.activeSince)
    : parseCycle(subscription.startedAt);

  if (
    chargeThisMonth > toCivilDay(now) &&
    compareCycles(today, floor) >= 0 &&
    (!subscription.lastGeneratedFor ||
      compareCycles(parseCycle(subscription.lastGeneratedFor), today) < 0)
  ) {
    return chargeThisMonth;
  }

  /**
   * Assinatura que ainda não começou: a próxima cobrança é a do PRIMEIRO ciclo
   * dela, não a do mês seguinte ao corrente.
   *
   * Sem esta checagem, uma assinatura com `startedAt` em novembro devolvia a
   * cobrança de setembro — o piso era calculado acima e ignorado aqui, então o
   * fallback pulava direto para "mês seguinte ao de hoje". Aparecia como
   * cobrança futura inventada, meses antes de a assinatura existir.
   */
  const next = addCycles(today, 1);
  const firstEligible = compareCycles(next, floor) < 0 ? floor : next;

  return chargeDateForCycle(firstEligible, subscription.dayOfMonth);
}
