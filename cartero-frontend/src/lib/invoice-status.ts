import { InvoiceStatus } from '@/types'

/**
 * Apresentação de InvoiceStatus — fonte única.
 *
 * Existia em triplicado (`budget`, `overview`, `banks/[id]/invoices`), com um
 * quarto vocabulário paralelo na lista de bancos que trocava o status por uma
 * contagem regressiva: o mesmo `CLOSED` aparecia como "Fechada" em três telas
 * e como "Vence em 5d" na quarta. Duplicação de rótulo é onde a divergência
 * começa, então o rótulo passa a ter um só lugar.
 *
 * Só cuida de vocabulário e cor. O layout continua sendo de cada tela.
 *
 * Estado e prazo são coisas separadas, e essa confusão era o defeito de fundo:
 * `CLOSED` é um estado, "vence em 5 dias" é uma informação temporal. Uma
 * fatura é "Fechada · vence em 5 dias" — não "Vence em 5 dias" no lugar do
 * estado. O tempo relativo vive em `invoice-timing.ts`.
 */

/** Vocabulário oficial. `OVERDUE` é "Em atraso" — nunca "Vencida"/"Atrasada". */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'Aberta',
  [InvoiceStatus.CLOSED]: 'Fechada',
  [InvoiceStatus.OVERDUE]: 'Em atraso',
  [InvoiceStatus.PAID]: 'Paga',
}

/**
 * Classes de badge por estado.
 *
 * `CLOSED` usa o token semântico `pending`, não `amber-*`. O `--pending`
 * (`oklch(0.720 0.150 60)`) já É o âmbar do design system e já tem bridge
 * Tailwind — o comentário `// no token for amber` que existia no código
 * estava errado. Nada de token novo: "fechada, esperando pagamento" é
 * exatamente o significado de `pending`.
 */
export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'bg-primary/15 text-primary',
  [InvoiceStatus.CLOSED]: 'bg-pending/15 text-pending',
  [InvoiceStatus.OVERDUE]: 'bg-destructive/15 text-destructive',
  [InvoiceStatus.PAID]: 'bg-paid/15 text-paid',
}

/** Só a cor do texto, para linhas que não levam badge. */
export const INVOICE_STATUS_TEXT: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'text-primary',
  [InvoiceStatus.CLOSED]: 'text-pending',
  [InvoiceStatus.OVERDUE]: 'text-destructive',
  [InvoiceStatus.PAID]: 'text-paid',
}

/**
 * Primitiva CSS por estado, para tints via `color-mix`.
 *
 * `CLOSED` aponta para `--pending` em vez do `oklch(0.750 0.150 80)` que
 * estava fixo no código.
 */
export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  [InvoiceStatus.OPEN]: 'var(--primary)',
  [InvoiceStatus.CLOSED]: 'var(--pending)',
  [InvoiceStatus.OVERDUE]: 'var(--destructive)',
  [InvoiceStatus.PAID]: 'var(--color-income)',
}

/** Urgência primeiro: em atraso, fechada, aberta, paga. */
export const INVOICE_STATUS_SORT_ORDER: Record<InvoiceStatus, number> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
  [InvoiceStatus.PAID]: 3,
}

/** Compatibilidade com o formato `{ label, className }` já usado nas telas. */
export function invoiceStatusConfig(status: InvoiceStatus): {
  label: string
  className: string
} {
  return {
    label: INVOICE_STATUS_LABEL[status],
    className: INVOICE_STATUS_BADGE[status],
  }
}
