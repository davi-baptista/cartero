import { InvoiceStatus } from '@prisma/client';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que impede a compra de origem de ser excluída
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma cobrança automática não é apagada por `DELETE /receivables/:id` — o
 * caminho é excluir a COMPRA, e a cascata remove a cobrança junto. Mas a
 * compra tem as próprias travas, e a mais dura é pertencer a uma fatura já
 * paga: excluí-la alteraria o total de algo já quitado.
 *
 * Sem este campo o frontend oferecia "Excluir compra e cobrança", o usuário
 * confirmava, e só então o backend recusava. A operação estava correta; a
 * expectativa é que estava errada.
 *
 * ── Por que é o servidor que responde ──
 *
 * A cobrança não carrega a fatura da compra, e buscá-la por linha seria N+1
 * numa lista. A relação `Receivable → transaction → invoice` já existe, então
 * a resposta sai da MESMA consulta, num `select` aninhado.
 *
 * ── Isto NÃO é a autoridade ──
 *
 * É antecipação. A guarda de verdade continua no delete de Transaction
 * (`status: 'PAID'` → `ForbiddenException`), e nada aqui a substitui: se o
 * estado mudar entre a leitura e a confirmação, o backend recusa igual. O
 * campo existe para não oferecer o que será negado, não para autorizar.
 */

/**
 * Motivos pelos quais a compra de origem não pode ser excluída.
 *
 * Union de um elemento só, deliberadamente: hoje a fatura paga é a única
 * trava que a leitura consegue antecipar sem consulta extra. Nomear o motivo
 * — em vez de devolver um booleano — deixa a UI explicar o que aconteceu, e
 * abre espaço para outros motivos sem quebrar o contrato.
 */
export type SourceDeleteBlockReason = 'PAID_INVOICE';

/** O mínimo que a leitura precisa carregar para decidir. */
export interface ReceivableWithSourceInvoice {
  transactionId: string | null;
  transaction?: {
    invoice?: { status: InvoiceStatus } | null;
  } | null;
}

/**
 * `select` da relação de origem, para reuso nas consultas de leitura.
 *
 * Só o `status` da fatura: devolver a transação ou a fatura inteiras
 * exporia o modelo para responder um enum.
 */
export const SOURCE_INVOICE_SELECT = {
  select: { invoice: { select: { status: true } } },
} as const;

/**
 * `null` quando a exclusão pela origem está liberada — ou quando a cobrança
 * nem é automática, caso em que a pergunta não se aplica.
 */
export function resolveSourceDeleteBlockReason(
  receivable: ReceivableWithSourceInvoice,
): SourceDeleteBlockReason | null {
  if (!receivable.transactionId) return null;

  /*
    Compra sem fatura (débito, PIX, boleto) não tem essa trava. `undefined`
    aqui é ausência de fatura, não fatura desconhecida: a relação foi pedida
    no `select`.
  */
  const status = receivable.transaction?.invoice?.status;

  return status === InvoiceStatus.PAID ? 'PAID_INVOICE' : null;
}
