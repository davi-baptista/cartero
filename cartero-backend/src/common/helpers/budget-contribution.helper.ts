import { civilDay } from './date-only.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quando a contribuição de uma Pessoa ao Orçamento ficou coberta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O Orçamento pergunta "quanto esta relação tira do meu bolso neste mês?", e a
 * resposta é o LÍQUIDO: `max(dívidas − recebíveis, 0)`.
 *
 * Devendo R$ 11 a alguém que me deve R$ 10, a saída planejada é R$ 1. Ao pagar
 * a dívida de R$ 11, essa saída está inteiramente coberta — mesmo que o
 * recebível de R$ 10 continue aberto.
 *
 * ── Por que NÃO usar o `settledAt` da Pessoa ──
 *
 * Aquele responde "a relação bilateral terminou?", e é outra pergunta. Enquanto
 * o recebível estiver aberto, a relação continua viva na página Pessoas — mas o
 * Orçamento já não espera mais nenhum desembolso.
 *
 * Acoplar os dois faria o Orçamento dizer "a pagar R$ 1" depois de o dinheiro
 * ter saído, só porque falta alguém me pagar.
 *
 * ── Por que NÃO usar `max(paidAt)` ──
 *
 * Com contribuição de R$ 50 e dívidas de R$ 30 (paga em 05/09) e R$ 100 (paga
 * em 12/09), a contribuição ficou coberta em 12/09 — o dia em que o acumulado
 * cruzou os R$ 50. Uma terceira dívida paga em 20/09 não muda isso: ela veio
 * depois de a saída já estar coberta, e `max(paidAt)` diria 20/09.
 *
 * A resposta é a primeira data em que o acumulado alcança o planejado.
 */

/** Um pagamento de dívida da competência. */
export interface DebtPayment {
  amount: number;
  paidAt: Date | null;
}

/** Tolerância de centavo, a mesma das outras superfícies. */
const EPSILON = 0.005;

export interface ContributionSettlement {
  /** A saída líquida planejada — `max(dívidas − recebíveis, 0)`. */
  planned: number;
  /** Quanto dela já foi coberto. Nunca ultrapassa `planned`. */
  paid: number;
  /** `planned - paid`, por construção. */
  remaining: number;
  /** A contribuição está inteiramente coberta? */
  isSettled: boolean;
  /**
   * `YYYY-MM-DD` civil em que a cobertura se completou, ou `null`.
   *
   * `null` quando ainda falta cobrir, quando não há planejamento (contribuição
   * zero) ou quando algum pagamento relevante não tem data confiável — nesse
   * caso a tela usa o fallback textual, sem inventar dia.
   */
  settledAt: string | null;
}

/**
 * Resolve o estado da contribuição de uma pessoa.
 *
 * ── O teto ──
 *
 * `paid` é limitado por `planned`: com R$ 130 em dívidas, R$ 80 a receber e
 * tudo quitado, o pago é R$ 50 — não R$ 130. Acima do planejado o número
 * deixaria de descrever esta competência, e a soma `paid + remaining` pararia
 * de fechar com o total.
 */
export function resolveContribution(
  planned: number,
  payments: readonly DebtPayment[],
): ContributionSettlement {
  const alvo = Math.max(planned, 0);

  if (alvo <= EPSILON) {
    /*
      Sem saída planejada não há o que cobrir. A pessoa não participa do
      orçamento, e afirmar "pago" sobre uma contribuição inexistente criaria
      exatamente o número sem origem que esta fase remove.
    */
    return {
      planned: 0,
      paid: 0,
      remaining: 0,
      isSettled: false,
      settledAt: null,
    };
  }

  /*
    Ordem cronológica: a resposta é QUANDO o acumulado cruzou o alvo, e isso
    depende da sequência. Sem data vai para o fim — não sabemos quando ocorreu,
    então não pode determinar o momento da cobertura.
  */
  const ordenados = [...payments].sort((a, b) => {
    if (!a.paidAt) return 1;
    if (!b.paidAt) return -1;
    return a.paidAt.getTime() - b.paidAt.getTime();
  });

  let acumulado = 0;
  let cobertura: Date | null = null;
  let semDataAntesDaCobertura = false;

  for (const pagamento of ordenados) {
    if (acumulado + EPSILON >= alvo) break;

    if (!pagamento.paidAt) {
      /*
        Um pagamento sem data que ainda era necessário para cobrir: o valor
        conta, mas o instante da cobertura deixa de ser afirmável.
      */
      semDataAntesDaCobertura = true;
    }

    acumulado += pagamento.amount;

    if (acumulado + EPSILON >= alvo && pagamento.paidAt) {
      cobertura = pagamento.paidAt;
    }
  }

  const paid = Math.min(acumulado, alvo);
  const isSettled = paid + EPSILON >= alvo;

  return {
    planned: alvo,
    paid,
    remaining: Math.max(alvo - paid, 0),
    isSettled,
    settledAt:
      isSettled && cobertura && !semDataAntesDaCobertura
        ? civilDay(cobertura)
        : null,
  };
}
