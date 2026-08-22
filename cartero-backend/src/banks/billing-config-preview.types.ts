import type { InvoiceStatus } from '@prisma/client';

/**
 * Impacto de uma alteração do ciclo de faturamento.
 *
 * Datas em ISO porque atravessam HTTP. `before`/`after` sempre em par: a
 * interface precisa mostrar "vence 08/09 → 15/09", e um valor sozinho não
 * diria o que está mudando.
 */
export interface BillingConfigInvoiceChange {
  invoiceId: string;
  year: number;
  month: number;
  closeDate: { before: string; after: string };
  dueDate: { before: string; after: string };
  status: { before: InvoiceStatus; after: InvoiceStatus };
  /** `true` quando a nova data já tira a fatura de aberta. */
  statusChanged: boolean;
}

export interface BillingConfigPreview {
  /** `true` quando o ciclo não muda — a interface não abre confirmação. */
  scheduleUnchanged: boolean;
  /** Faturas em aberto que terão as datas atualizadas. */
  affectedCount: number;
  /** Quantas dessas passam a fechada/em atraso imediatamente. */
  statusChangeCount: number;
  /** Cobranças automáticas pendentes que acompanham o novo vencimento. */
  pendingReceivables: number;
  changes: BillingConfigInvoiceChange[];
}
