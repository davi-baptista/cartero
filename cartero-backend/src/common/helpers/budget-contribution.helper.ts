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
 *
 * ══════════════════════════════════════════════════════════════════════════
 * O recebível abate os DOIS lados
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `receivables` existe porque a versão anterior era ASSIMÉTRICA:
 *
 *   planned = max(dívidas − recebíveis, 0)   ← o recebível subtraía
 *   paid    = min(planned, Σ dívidas pagas)  ← o recebível NÃO subtraía
 *
 * O mesmo recebível reduzia o alvo e deixava o bruto das dívidas pagas
 * preencher sozinho o alvo reduzido — dois benefícios da mesma entrada.
 *
 * ── O que isso produzia em produção ──
 *
 *   dívida aberta   R$  11,00
 *   dívidas pagas   R$  85,37
 *   recebíveis      R$  39,13
 *
 *   planned = 11 + 85,37 − 39,13 = 57,24
 *   paid    = min(57,24, 85,37)  = 57,24   →  remaining 0, "PAGO"
 *
 * A dívida de R$ 11 estava ABERTA e vencida, e mesmo assim a competência se
 * declarava quitada: a folga entre 85,37 e 57,24 — que é exatamente o
 * recebível — absorvia a obrigação em aberto. Qualquer dívida até o valor do
 * recebível ficava invisível.
 *
 * ── A simetria ──
 *
 * O acumulador COMEÇA em `−receivables`: os pagamentos primeiro repõem o que
 * o recebível já descontou do alvo, e só o excedente cobre o planejado.
 * Equivale a `max(Σ pagas − recebíveis, 0)`, mas preservando a ordem
 * cronológica que decide `settledAt` — um `max` no fim perderia qual
 * pagamento completou a cobertura.
 *
 *   paid = min(planned, max(Σ pagas − recebíveis, 0)) = 46,24
 *   remaining = 11,00  →  não quitada, que é o fato
 *
 * ── O que NÃO mudou ──
 *
 * Isto não é `anyOpenDebt`. Com dívida de R$ 30 e recebível de R$ 50 o
 * planejado continua ZERO e a pessoa segue fora do orçamento, mesmo com item
 * aberto — o netting por pessoa está preservado. E o caso de R$ 11 devidos
 * com R$ 10 a receber continua quitado ao pagar a dívida: 11 − 10 = 1 de
 * alvo, 11 − 10 = 1 de cobertura.
 */
export function resolveContribution(
  planned: number,
  payments: readonly DebtPayment[],
  receivables = 0,
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

  /*
    Começa NEGATIVO no valor dos recebíveis.

    O recebível já foi descontado de `alvo`; contá-lo só ali daria a ele dois
    efeitos. Partindo de `−recebíveis`, cada pagamento primeiro repõe esse
    desconto e apenas o excedente cobre o planejado.
  */
  let acumulado = -Math.max(receivables, 0);
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

  /*
    `max(acumulado, 0)`: com recebíveis maiores que os pagamentos o acumulado
    fica negativo, e um `paid` negativo quebraria `paid + remaining = planned`.
    Zero é a leitura correta — nada da saída planejada foi coberto ainda.
  */
  const paid = Math.min(Math.max(acumulado, 0), alvo);
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
