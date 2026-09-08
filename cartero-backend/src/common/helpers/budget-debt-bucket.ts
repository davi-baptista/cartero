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
 * ── Competência: o VENCIMENTO, paga ou não (contrato V2) ──
 *
 * A competência de uma dívida é o mês em que ela venceu — o pagamento não a
 * desloca. Vencida em janeiro e paga em março, ela pertence a JANEIRO.
 *
 * O contrato anterior usava `paidAt` para a dívida paga, com o argumento de
 * que "julho não viu esse dinheiro sair". O argumento é verdadeiro sobre
 * FLUXO DE CAIXA, e foi por isso que a regra existiu. Mas o Budget não é
 * fluxo de caixa: é competência e planejamento.
 *
 *   BUDGET   competência original + obrigações atrasadas ainda abertas
 *   EXTRATO  a data real em que o dinheiro movimentou
 *
 * Deslocar a dívida para o mês do pagamento fazia o Budget responder a
 * pergunta do Extrato — e obrigava o usuário a pensar "em que mês eu paguei
 * isso?" para a tela ficar organizada. Quem abre o app uma vez por semana
 * não deveria precisar.
 *
 * ── A consequência é deliberada ──
 *
 * O mês em que o dinheiro efetivamente saiu deixa de contar aquele
 * desembolso, e `totalToPay` daquele mês diminui. Isso é intencional: o fato
 * financeiro está no Extrato, e a obrigação está na competência dela.
 *
 * `paidAt` continua no modelo — para auditoria, detalhe e histórico da
 * entidade. Só deixou de decidir posicionamento mensal no Budget.
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
 * A competência da dívida: o mês em que ela VENCEU.
 *
 * Não consulta `paidAt` — é o contrato V2. A assinatura mantém
 * `ClassifiableDebt` porque `classifyDebtForBudget` ainda precisa de `isPaid`
 * e `personId` para escolher o balde; só a COMPETÊNCIA parou de depender do
 * pagamento.
 *
 * Exportada porque o serviço precisa da mesma resposta ao montar os totais —
 * derivá-la de novo lá seria a segunda cópia da regra.
 */
export function debtFinancialPeriod(debt: ClassifiableDebt): BudgetPeriod {
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
      Paga: pertence à competência do VENCIMENTO, e só a ela.

      Fora dela, nada — inclusive no mês em que o pagamento aconteceu. Era
      justamente esse deslocamento que fazia a dívida de janeiro reaparecer
      em março, e que esta fase remove.
    */
    if (compare(due, selected) !== 0) return 'excluded';

    /*
      Na própria competência, resolvida: balde normal, nunca `prior`.

      `Pendências anteriores` passou a ser uma fila VIVA — só entra o que
      ainda exige ação. Uma dívida paga na sua própria competência aparece
      ali como PAGA, na seção dela.
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
