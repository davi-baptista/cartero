import type { InstallmentPreservationReason } from '../common/helpers/installment-delete-plan';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que a exclusão de uma compra parcelada vai fazer, antes de fazer
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Espelha `TransactionUpdatePreview`: a edição já avisava o que ia acontecer,
 * a exclusão não. O resultado era o diálogo oferecer "Todas as parcelas" numa
 * série com histórico pago, o usuário confirmar, e só então descobrir pelo
 * 403 — dentro de um diálogo que continuava aberto, sem dizer qual operação
 * teria funcionado.
 *
 * A prévia é ANTECIPAÇÃO, não autorização: a execução recalcula tudo. O que
 * ela garante é que a tela não ofereça o que o servidor já sabe que recusa.
 */

/** Uma parcela que será removida. */
export interface DeletePreviewInstallment {
  id: string;
  /** Posição original na série (`7` em "7/10"), ou `null` fora de série. */
  installmentNumber: number | null;
  amount: number;
  date: Date;
}

/** Uma parcela que sobrevive, e o motivo. */
export interface DeletePreviewPreserved extends DeletePreviewInstallment {
  reason: InstallmentPreservationReason;
  /** Texto pronto para a tela. O código é que decide; isto explica. */
  message: string;
}

export interface TransactionDeletePreview {
  /**
   * `false` para compra à vista.
   *
   * A prévia responde para qualquer transação em vez de recusar — assim a
   * tela pode perguntar sem saber de antemão, e usa o fluxo simples quando a
   * resposta é negativa. Recusar obrigaria o cliente a decidir primeiro
   * aquilo que ele consultaria para decidir.
   */
  isInstallment: boolean;

  /** Quantas parcelas a série tem hoje. */
  seriesTotal: number;

  deletableCount: number;
  preservedCount: number;

  /** Soma real das deletáveis — nunca valor × quantidade. */
  deletableTotal: number;

  deletable: DeletePreviewInstallment[];
  preserved: DeletePreviewPreserved[];

  /** Cobranças pendentes que saem junto com suas compras. */
  receivablesRemoved: number;
  /** Faturas que ficarão sem nenhum lançamento. */
  invoicesEmptied: number;
}

/** O que a execução devolve — o conjunto REAL, não o previsto. */
export interface TransactionDeleteResult {
  deletedIds: string[];
  deletedCount: number;
  preservedIds: string[];
  receivablesRemoved: number;
  invoicesEmptied: number;
}

/**
 * Texto de cada motivo.
 *
 * Mora ao lado do tipo para que um motivo novo não possa ser adicionado sem
 * a frase correspondente — o `Record` obriga o compilador a cobrar.
 */
export const PRESERVATION_MESSAGES: Record<
  InstallmentPreservationReason,
  string
> = {
  PAID_INVOICE: 'A fatura desta parcela já foi paga.',
  RECEIVABLE_ALREADY_PAID: 'A cobrança desta parcela já foi recebida.',
  PAYMENT_TRANSACTION_LINKED:
    'Esta parcela registra o pagamento de uma dívida ou cobrança.',
};
