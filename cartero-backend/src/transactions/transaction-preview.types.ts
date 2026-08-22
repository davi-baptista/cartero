import { TransactionType } from '@prisma/client';

/** Fatura que vai receber uma parcela — existente ou ainda a ser criada. */
export interface PreviewInvoice {
  year: number;
  month: number;
  dueDate: Date | null;
  closeDate: Date | null;
  /** Status atual, ou `null` quando a fatura ainda não existe. */
  status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE' | null;
  exists: boolean;
}

export interface PreviewInstallment {
  number: number;
  /** Total de parcelas da compra — 1 quando à vista. */
  of: number;
  amount: number;
  title: string;
  /** `null` para lançamentos que não entram em fatura (débito, PIX, receita). */
  invoice: PreviewInvoice | null;
}

/** Cobranças que a compra vai gerar quando for para outra pessoa. */
export interface PreviewReceivables {
  personId: string;
  personName: string;
  /** Soma das cobranças — igual ao total da compra. */
  total: number;
  count: number;
  items: Array<{
    number: number;
    amount: number;
    /** Vencimento herdado da fatura da parcela correspondente. */
    dueDate: Date | null;
  }>;
}

/**
 * O que a criação vai produzir, calculado sem escrever nada.
 *
 * `blocked` é preenchido quando o estado atual já garante que a criação será
 * recusada — a prévia não deve prometer uma operação que vai falhar.
 */
export interface TransactionPreview {
  type: TransactionType;
  isRefund: boolean;
  totalAmount: number;
  installmentCount: number;
  /** `true` quando o lançamento entra em fatura de cartão. */
  affectsInvoice: boolean;
  installments: PreviewInstallment[];
  receivables: PreviewReceivables | null;
  blocked: { code: string; message: string } | null;
}
