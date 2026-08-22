import { ConflictException } from '@nestjs/common';

/**
 * Estorno vinculado a outra pessoa não é uma combinação suportada.
 *
 * O efeito no domínio atual é financeiramente incoerente: o estorno DECREMENTA
 * a fatura (devolve dinheiro ao usuário) e, ao mesmo tempo, criava um
 * `Receivable` POSITIVO — registrando que a pessoa ainda deve o valor. O
 * usuário recebia duas vezes.
 *
 * Pior, `create` e `update` discordavam: o update tem `!isRefund` na condição
 * de sincronização e removia o recebível; o create não checava e o criava.
 *
 * Resolver de verdade exigiria três coisas que o schema não tem:
 *
 * ─── DÍVIDA TÉCNICA ────────────────────────────────────────────────────────
 * Estorno de compra de terceiro exige vínculo estrutural com a transação
 * original (`refundsTransactionId`), regra explícita de ajuste do `Receivable`
 * correspondente, e suporte a recebimento parcial — hoje `isPaid` é booleano.
 * Sem isso não há como decidir automaticamente qual cobrança abater.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const REFUND_PERSON_NOT_SUPPORTED = 'REFUND_PERSON_NOT_SUPPORTED';

const MESSAGE = 'Um estorno não pode ser vinculado a outra pessoa.';

/**
 * Recusa a combinação estorno + pessoa.
 *
 * Recebe o estado EFETIVO (o que a operação vai deixar gravado), não o payload
 * cru: numa edição, `isRefund` pode vir do registro existente e `personId` do
 * DTO, ou vice-versa.
 */
export function assertRefundHasNoPerson(
  isRefund: boolean | null | undefined,
  personId: string | null | undefined,
): void {
  if (isRefund && personId) {
    throw new ConflictException({
      message: MESSAGE,
      code: REFUND_PERSON_NOT_SUPPORTED,
    });
  }
}

/** `true` quando o par resultante seria a combinação recusada. */
export function isRefundWithPerson(
  isRefund: boolean | null | undefined,
  personId: string | null | undefined,
): boolean {
  return Boolean(isRefund && personId);
}
