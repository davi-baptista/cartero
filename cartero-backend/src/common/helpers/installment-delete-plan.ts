import { InvoiceStatus } from '@prisma/client';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que uma compra parcelada perde ao ser excluída — e o que ela guarda
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `ONE`, `NEXT` e `ALL` perguntam "quantas parcelas a partir daqui?". A
 * pergunta certa era outra: "o que desta compra ainda pode ser desfeito?".
 *
 * A diferença aparece na série parcialmente paga, que é o estado normal de
 * qualquer parcelamento depois de alguns meses. Com 1–6 em faturas pagas e
 * 7–10 abertas, `ALL` era recusado inteiro — o histórico bloqueava o futuro.
 * O usuário que queria cancelar o resto da compra recebia 403 e nenhuma
 * indicação de que `NEXT` a partir da 7 teria funcionado.
 *
 * `OPEN` responde a pergunta certa: remove tudo que ainda é reversível e
 * preserva o que virou fato consumado.
 *
 * ── Aberta não é o mesmo que deletável ──
 *
 * Uma parcela vencida e não liquidada continua ABERTA: vencer não consolida
 * nada. Mas ela pode estar protegida por outro motivo — a cobrança dela já
 * foi recebida, por exemplo. Os dois conceitos são separados de propósito;
 * colapsá-los produziria ora exclusão indevida, ora recusa inexplicável.
 *
 * ── Esta é a autoridade, e é uma só ──
 *
 * A prévia e a execução chamam a MESMA função. Duas implementações da mesma
 * regra divergiriam com o tempo, e o sintoma seria o pior possível: a tela
 * prometendo uma coisa e o servidor fazendo outra.
 */

/**
 * Por que uma parcela sobrevive à exclusão.
 *
 * São exatamente as três travas que o `remove` já aplicava — nenhuma
 * inventada aqui. `PAID_INVOICE` repete deliberadamente o vocabulário de
 * `receivable-source-capability.ts`: é a mesma trava vista de outro ângulo, e
 * dois nomes para ela obrigariam a UI a traduzir.
 */
export type InstallmentPreservationReason =
  /** Pertence a fatura já paga: excluí-la mudaria o total de algo quitado. */
  | 'PAID_INVOICE'
  /** A cobrança derivada já foi recebida — apagá-la deixaria a entrada órfã. */
  | 'RECEIVABLE_ALREADY_PAID'
  /** É o comprovante de uma dívida ou cobrança quitada. */
  | 'PAYMENT_TRANSACTION_LINKED';

/** O mínimo que o plano precisa saber sobre cada parcela. */
export interface InstallmentCandidate {
  id: string;
  amount: unknown;
  date: Date;
  title: string;
  invoiceId: string | null;
}

/** Fatos externos à transação que decidem se ela está protegida. */
export interface InstallmentProtectionFacts {
  /** Ids de fatura com `status = PAID`. */
  paidInvoiceIds: ReadonlySet<string>;
  /** Ids de transação cuja cobrança derivada já foi recebida. */
  receivedReceivableSourceIds: ReadonlySet<string>;
  /** Ids de transação que comprovam a quitação de uma dívida ou cobrança. */
  paymentTransactionIds: ReadonlySet<string>;
  /** Ids de transação com cobrança derivada AINDA pendente. */
  pendingReceivableSourceIds: ReadonlySet<string>;
}

export interface PreservedInstallment {
  transaction: InstallmentCandidate;
  reason: InstallmentPreservationReason;
}

export interface InstallmentDeletePlan {
  /** A série inteira, na ordem em que foi resolvida. */
  series: InstallmentCandidate[];
  deletable: InstallmentCandidate[];
  preserved: PreservedInstallment[];
  /** Cobranças pendentes que saem junto com suas compras de origem. */
  receivablesRemoved: number;
  /** Faturas que ficarão sem nenhum lançamento. */
  invoicesEmptied: string[];
}

/**
 * A trava que protege uma parcela, ou `null` se ela pode ser removida.
 *
 * ── Precedência ──
 *
 * A ordem é a MESMA do `remove` legado: fatura paga, depois cobrança
 * recebida, depois comprovante de quitação. Uma parcela pode satisfazer mais
 * de uma condição, e sem ordem fixa a prévia diria um motivo e a recusa
 * diria outro — o usuário leria as duas telas como contraditórias.
 */
export function resolvePreservationReason(
  transaction: InstallmentCandidate,
  facts: InstallmentProtectionFacts,
): InstallmentPreservationReason | null {
  if (transaction.invoiceId && facts.paidInvoiceIds.has(transaction.invoiceId)) {
    return 'PAID_INVOICE';
  }

  if (facts.receivedReceivableSourceIds.has(transaction.id)) {
    return 'RECEIVABLE_ALREADY_PAID';
  }

  if (facts.paymentTransactionIds.has(transaction.id)) {
    return 'PAYMENT_TRANSACTION_LINKED';
  }

  return null;
}

/**
 * Divide a série entre o que sai e o que fica.
 *
 * Função pura: recebe a série já resolvida e os fatos já consultados, e não
 * toca no banco. É o que permite testá-la sem fixture e reusá-la dentro da
 * transação de escrita, onde uma consulta a mais custaria caro.
 */
export function buildInstallmentDeletePlan(
  series: InstallmentCandidate[],
  facts: InstallmentProtectionFacts,
  invoiceTotals: ReadonlyMap<string, number>,
): InstallmentDeletePlan {
  const deletable: InstallmentCandidate[] = [];
  const preserved: PreservedInstallment[] = [];

  for (const transaction of series) {
    const reason = resolvePreservationReason(transaction, facts);
    if (reason) {
      preserved.push({ transaction, reason });
    } else {
      deletable.push(transaction);
    }
  }

  /*
    Uma cobrança pendente é derivada da compra: a compra sai, ela sai junto
    pela cascata que já existe. Só contam as de parcelas realmente deletáveis
    — a de uma parcela preservada continua de pé.
  */
  const receivablesRemoved = deletable.filter((transaction) =>
    facts.pendingReceivableSourceIds.has(transaction.id),
  ).length;

  /*
    Quais faturas ficam vazias.

    Duas parcelas da mesma compra podem cair na mesma fatura, então o desconto
    é SOMADO por fatura antes de comparar com o total. Descontar uma parcela
    por vez diria que a fatura não zerou quando ela zera, e a UI prometeria
    algo diferente do que a execução faria.

    O total vem da fatura, não da série: a mesma fatura costuma conter outras
    compras, e são elas que impedem o zero.
  */
  const descontoPorFatura = new Map<string, number>();
  for (const transaction of deletable) {
    if (!transaction.invoiceId) continue;
    const atual = descontoPorFatura.get(transaction.invoiceId) ?? 0;
    descontoPorFatura.set(
      transaction.invoiceId,
      atual + Number(transaction.amount),
    );
  }

  const invoicesEmptied: string[] = [];
  for (const [invoiceId, desconto] of descontoPorFatura) {
    const total = invoiceTotals.get(invoiceId);
    if (total === undefined) continue;
    /*
      Centavos: a soma das parcelas nunca é fracionada aqui — os valores vêm
      do banco em decimal e a comparação é de igualdade sobre o resíduo.
    */
    if (Math.abs(total - desconto) < 0.005) invoicesEmptied.push(invoiceId);
  }

  return {
    series,
    deletable,
    preserved,
    receivablesRemoved,
    invoicesEmptied,
  };
}

/**
 * O número da parcela, lido do título — nunca recalculado.
 *
 * `7/10` continua sendo a sétima de dez mesmo depois que 8, 9 e 10 saírem. O
 * título registra o contrato original da compra, e renumerar reescreveria a
 * história para caber no que sobrou.
 */
export function readInstallmentNumber(title: string): number | null {
  const match = title.match(/\s(\d+)\/\d+$/);
  return match ? Number(match[1]) : null;
}

/**
 * O conjunto deletável mudou entre a prévia e a confirmação?
 *
 * Compara IDENTIDADES, não a quantidade. Se a parcela B ficar protegida e a D
 * deixar de estar, a contagem continua três e a execução apagaria um conjunto
 * diferente do que o usuário confirmou — silenciosamente, que é o pior modo
 * de errar numa operação destrutiva.
 *
 * A ordem não importa: é o mesmo plano, resolvido duas vezes.
 */
export function deletableSetChanged(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (expected.length !== actual.length) return true;
  const esperados = new Set(expected);
  return actual.some((id) => !esperados.has(id));
}

/** Fatura paga, para quem só tem o status em mãos. */
export function isPaidInvoiceStatus(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.PAID;
}
