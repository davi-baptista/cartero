import { Prisma } from '@prisma/client';
import type { Debt, Receivable } from '@prisma/client';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Consolidado da relação financeira com uma Person
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O extrato antigo filtrava dívidas e cobranças por `dueDate` dentro do mês
 * escolhido — e chamava o resultado de "total". Uma dívida vencida em junho e
 * ainda aberta desaparecia do extrato de agosto: os números diziam
 * "{Nome} te deve no total R$ 200" quando a pessoa devia R$ 500.
 *
 * Pior, `settle` recebia os mesmos limites e quitava só o mês visível,
 * relatando "N itens quitados" sem dizer que deixou pendências antigas
 * abertas.
 *
 * A regra oficial: o consolidado é ALL-TIME. Uma obrigação aberta é uma
 * obrigação aberta, independente do mês em que venceu ou vai vencer. O
 * seletor de mês governa a perspectiva HISTÓRICA — o que foi quitado naquele
 * período — e nada mais.
 */

/** Um item pendente, com o mínimo que o consolidado precisa somar. */
type PendingItem = Pick<Debt, 'amount'> | Pick<Receivable, 'amount'>;

export interface PersonSummary {
  /** Soma de TODOS os Receivables pendentes. Sem recorte temporal. */
  receivablePending: number;
  /** Soma de TODAS as Debts pendentes. Sem recorte temporal. */
  debtPending: number;
  /**
   * `receivablePending - debtPending`.
   *
   * Informativo. A quitação NÃO usa este número: cada item é liquidado pelo
   * próprio valor integral. R$ 800 a receber e R$ 300 a pagar não viram um
   * movimento de R$ 500 — viram R$ 800 recebidos e R$ 300 pagos.
   */
  netBalance: number;
  pendingReceivablesCount: number;
  pendingDebtsCount: number;
  /**
   * `true` só quando NÃO existe nenhuma obrigação aberta.
   *
   * Não é `netBalance === 0`. Com R$ 500 dos dois lados o saldo é zero e
   * ainda existem duas pendências — dizer "tudo acertado" ali seria falso, e
   * era exatamente o que a mensagem do WhatsApp fazia.
   */
  isFullySettled: boolean;
}

export function sumAmounts(items: PendingItem[]): number {
  return items.reduce((total, item) => total + Number(item.amount), 0);
}

/**
 * Monta o resumo a partir das pendências já carregadas.
 *
 * Função pura e sem acesso ao banco: é a mesma para o drawer, o PDF, o
 * WhatsApp e o settle, e por isso os quatro não podem divergir.
 */
export function buildPersonSummary(
  pendingReceivables: PendingItem[],
  pendingDebts: PendingItem[],
): PersonSummary {
  const receivablePending = sumAmounts(pendingReceivables);
  const debtPending = sumAmounts(pendingDebts);

  return {
    receivablePending,
    debtPending,
    netBalance: receivablePending - debtPending,
    pendingReceivablesCount: pendingReceivables.length,
    pendingDebtsCount: pendingDebts.length,
    isFullySettled:
      pendingReceivables.length === 0 && pendingDebts.length === 0,
  };
}

/**
 * Ordenação das pendências: quem já venceu primeiro, depois o vencimento mais
 * próximo.
 *
 * A lista responde "o que preciso resolver agora?", e a resposta começa pelo
 * que já passou do prazo. Entre dois itens em atraso, o mais antigo vem antes
 * — está esperando há mais tempo.
 */
export const PENDING_ORDER: Prisma.DebtOrderByWithRelationInput[] = [
  { dueDate: 'asc' },
];

/**
 * Ordenação do histórico: mais recente primeiro.
 *
 * Quem abre o histórico quer conferir o que acabou de acontecer, não
 * arqueologia. `paidAt` pode ser nulo em registros antigos marcados antes de
 * o campo existir, então `dueDate` serve de desempate.
 */
export const HISTORY_ORDER: Prisma.DebtOrderByWithRelationInput[] = [
  { paidAt: 'desc' },
  { dueDate: 'desc' },
];
