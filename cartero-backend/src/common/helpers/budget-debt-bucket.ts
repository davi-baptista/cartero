import { civilDay } from './date-only.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Em qual balde do Orçamento uma dívida entra
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O Orçamento responde "quanto sai do meu bolso neste mês?". Uma dívida
 * contribui NO MÁXIMO UMA VEZ para a resposta — e o balde é único por
 * construção, não por dedupe no fim.
 *
 * O bug que motivou este arquivo: "Dívidas · R$ 600,00" e "Pendências
 * anteriores · R$ 600,00" exibiam a MESMA dívida. Havia dois predicados
 * sobrepostos — um conjunto de "paga nesta competência" (qualquer
 * vencimento) alimentava as pendências anteriores, enquanto a mesma linha
 * seguia para o balde normal. `paidAt > dueDate` era tratado como se
 * significasse "vem de um mês anterior", e não significa: pagar com três
 * dias de atraso dentro do próprio mês não muda a competência de origem.
 *
 * ── As duas perguntas, em ordem ──
 *
 *   1. Esta dívida pertence financeiramente ao mês selecionado?
 *   2. Se pertence, a ORIGEM dela é anterior a ele?
 *
 * A temporalidade decide primeiro; a pessoa só desempata depois. Antes, uma
 * dívida antiga com `personId` era capturada por "Acertos com pessoas" antes
 * de qualquer verificação temporal — e sumia das pendências.
 *
 * ── Competência financeira ──
 *
 * PAGA   → `paidAt`, sempre. É quando o dinheiro saiu, e é a pergunta da
 *          tela. Uma dívida vencida em julho e paga em agosto pertence a
 *          AGOSTO: julho não viu esse dinheiro sair.
 *
 * ABERTA → o vencimento, mas só como PLANEJAMENTO — e planejamento só existe
 *          do mês corrente em diante. Reconstruir julho hoje e somar uma
 *          dívida que continua aberta afirmaria um desembolso que nunca
 *          aconteceu.
 *
 * Legado pago sem `paidAt` cai no vencimento: sem saber quando o dinheiro
 * saiu, o melhor palpite é a data que temos. Exibir a mais é recuperável;
 * sumir com uma obrigação não é.
 */

export interface BudgetPeriod {
  year: number;
  /** 1-12. */
  month: number;
}

/** O mínimo para classificar. */
export interface ClassifiableDebt {
  dueDate: Date;
  isPaid: boolean;
  paidAt?: Date | null;
  personId?: string | null;
}

/**
 * O balde. União discriminada de propósito: uma dívida não tem como voltar
 * `current` E `prior` — o tipo torna a duplicação impossível de expressar.
 */
export type DebtBucket =
  /** Obrigação do próprio mês, sem pessoa → seção "Dívidas". */
  | 'currentGeneric'
  /** Obrigação do próprio mês, com pessoa → "Acertos com pessoas". */
  | 'currentPerson'
  /** Origem anterior ao mês → "Pendências anteriores", com ou sem pessoa. */
  | 'prior'
  /** Não pertence financeiramente a este mês. */
  | 'excluded';

const asPeriod = (date: Date): BudgetPeriod => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
});

/** Negativo se `a` vem antes de `b`; zero se é a mesma competência. */
function compare(a: BudgetPeriod, b: BudgetPeriod): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/**
 * O dia civil de hoje como instante UTC.
 *
 * `dueDate < hoje` exclui o que vence HOJE: no próprio dia do vencimento
 * ainda há o dia inteiro para resolver. Mesma fronteira de `overdueBound` no
 * serviço — as duas precisam concordar, ou a consulta traz uma coisa e a
 * classificação decide outra.
 */
function todayBound(now: Date): Date {
  return new Date(`${civilDay(now)}T00:00:00.000Z`);
}

/**
 * A competência FINANCEIRA da dívida: o mês em que ela conta.
 *
 * Exportada porque o serviço precisa da mesma resposta ao montar os totais —
 * derivá-la de novo lá seria a segunda cópia da regra.
 */
export function debtFinancialPeriod(debt: ClassifiableDebt): BudgetPeriod {
  if (debt.isPaid && debt.paidAt) return asPeriod(debt.paidAt);
  return asPeriod(debt.dueDate);
}

export function classifyDebtForBudget(
  debt: ClassifiableDebt,
  selected: BudgetPeriod,
  now: Date = new Date(),
): DebtBucket {
  const due = asPeriod(debt.dueDate);
  const current = asPeriod(now);
  const selectedIsPast = compare(selected, current) < 0;

  if (debt.isPaid) {
    /*
      Paga: só o mês do desembolso. Nunca o vencimento também — era assim que
      a mesma R$ 300 aparecia em dezembro e em agosto.
    */
    if (compare(debtFinancialPeriod(debt), selected) !== 0) return 'excluded';

    /*
      Origem anterior → pendência anterior, mesmo com pessoa.

      `paidAt > dueDate` NÃO basta: vencer 20/08 e pagar 28/08 é atraso
      dentro do próprio mês, não obrigação herdada. O que decide é o
      vencimento ter caído numa competência anterior à selecionada.
    */
    if (compare(due, selected) < 0) return 'prior';

    /*
      Pagamento antecipado (vence em setembro, pago em agosto) cai aqui: conta
      uma vez, em agosto, no balde normal. Chamá-lo de "pendência anterior"
      seria o oposto do que aconteceu.
    */
    return debt.personId ? 'currentPerson' : 'currentGeneric';
  }

  /*
    Aberta e o mês selecionado já passou: nada a somar.

    O dinheiro não saiu naquele mês — e continua não tendo saído. Contá-lo
    inventaria um desembolso histórico que nunca existiu.
  */
  if (selectedIsPast) return 'excluded';

  /* Vence no mês selecionado: planejamento normal. */
  if (compare(due, selected) === 0) {
    return debt.personId ? 'currentPerson' : 'currentGeneric';
  }

  /* Vence depois: é problema de outro mês. */
  if (compare(due, selected) > 0) return 'excluded';

  /*
    Venceu antes do mês selecionado e continua aberta.

    Só carrega para o mês CORRENTE: projetar a pendência para setembro
    afirmaria que ela ainda estará aberta lá, o que ninguém sabe. É a regra
    de "no future overdue projection", já consolidada.

    E precisa estar genuinamente vencida hoje — o que vence hoje ainda tem o
    dia inteiro.
  */
  const isCurrentMonth = compare(selected, current) === 0;
  if (!isCurrentMonth) return 'excluded';

  return debt.dueDate < todayBound(now) ? 'prior' : 'excluded';
}
