/**
 * Impacto projetado de uma edição.
 *
 * Só carrega o que MUDA — a interface não deve mostrar campo que permaneceu
 * igual. Cada bloco é `null` quando aquele aspecto não é afetado.
 */

/** Um valor antes e depois, quando ele muda. */
export interface PreviewChange<T> {
  before: T;
  after: T;
}

export interface UpdatePreviewInvoiceChange {
  /** Índice da parcela na série, quando aplicável. */
  installmentNumber: number | null;
  from: { year: number; month: number } | null;
  to: { year: number; month: number } | null;
  dueDate: PreviewChange<string | null>;
}

export interface TransactionUpdatePreview {
  /** Quantas transações o escopo escolhido atinge. */
  affectedCount: number;
  /** `true` quando a edição não altera nenhum fato financeiro. */
  descriptiveOnly: boolean;
  /** Escopo efetivamente aplicado — a data força ALL. */
  scope: 'ONE' | 'NEXT' | 'ALL';
  /** `true` quando o escopo foi imposto pela regra, não escolhido. */
  scopeForced: boolean;

  /** Valor por parcela, quando muda. */
  amountPerInstallment: PreviewChange<number> | null;
  /**
   * Soma das parcelas afetadas, antes e depois.
   *
   * Sempre a soma real dos registros — nunca `valor × quantidade`, porque uma
   * série pode ter centavos diferentes entre parcelas.
   */
  affectedTotal: PreviewChange<number> | null;
  /** Soma da série inteira, quando a transação pertence a um parcelamento. */
  seriesTotal: PreviewChange<number> | null;

  /** Mudanças de competência/vencimento, uma por parcela afetada. */
  invoiceChanges: UpdatePreviewInvoiceChange[];

  /** Mudança de responsável pela compra. */
  person: {
    before: { id: string; name: string } | null;
    after: { id: string; name: string } | null;
    /** Quantas cobranças serão criadas, atualizadas ou removidas. */
    receivablesCreated: number;
    receivablesUpdated: number;
    receivablesRemoved: number;
  } | null;

  /** Operação que o save vai recusar — não ofereça confirmação. */
  blocked: { code: string; message: string } | null;
  /** Operação possível, mas que exige confirmação explícita. */
  requiresConfirmation: { code: string; message: string } | null;
}
