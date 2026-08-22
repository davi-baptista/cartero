import type { Invoice, InvoiceStatus } from '@prisma/client';
import {
  deriveStatusFromInvoiceDates,
  getInvoiceCloseDateForPeriod,
  getInvoiceDueDateForPeriod,
  type InvoiceSchedule,
} from 'src/common/helpers/invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Plano de alteração do ciclo de faturamento — função pura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Decide o que muda quando o usuário altera o dia de vencimento ou o intervalo
 * de fechamento de um banco. Sem I/O: recebe as faturas e devolve o plano, o
 * que permite que a PRÉVIA e o SAVE usem exatamente a mesma decisão — o mesmo
 * padrão que resolveu a divergência entre preview e update em Transactions.
 *
 * ─── A regra de produto ───────────────────────────────────────────────────
 *
 * `CLOSED`, `OVERDUE` e `PAID` têm datas históricas: são fatos, e nenhuma
 * reconfiguração do cartão as altera.
 *
 * `OPEN` pertence a um ciclo que ainda não encerrou, então acompanha a nova
 * configuração. Isso não é conveniência: um parcelamento em 10x cria faturas
 * futuras de imediato, e sem isso uma mudança de cartão levaria meses para
 * surtir efeito nas faturas já materializadas.
 *
 * ─── O que NÃO acontece ───────────────────────────────────────────────────
 *
 * Transações não são reclassificadas entre faturas. `month`/`year`,
 * `invoiceId` e `totalAmount` ficam intactos: só as DATAS da fatura mudam.
 * Redistribuir lançamentos seria reescrever histórico em cascata — uma compra
 * que sempre pertenceu à fatura de outubro passaria para novembro sem que
 * ninguém tivesse pedido.
 */

/** Uma fatura elegível e o efeito da mudança sobre ela. */
export interface InvoiceDateChange {
  invoiceId: string;
  year: number;
  month: number;
  closeDate: { before: Date; after: Date };
  dueDate: { before: Date; after: Date };
  status: { before: InvoiceStatus; after: InvoiceStatus };
  /** `true` quando a nova data já faz a fatura sair de OPEN. */
  statusChanged: boolean;
}

/** Fatura que foi considerada e recusada, com o motivo. */
export interface SkippedInvoice {
  invoiceId: string;
  year: number;
  month: number;
  reason: 'HISTORICAL_STATUS' | 'EFFECTIVELY_CLOSED' | 'NO_DATE_CHANGE';
}

export interface BillingConfigPlan {
  /** `true` quando nada no ciclo muda — vencimento e intervalo iguais. */
  scheduleUnchanged: boolean;
  changes: InvoiceDateChange[];
  skipped: SkippedInvoice[];
  /** Configuração que passa a valer. */
  schedule: InvoiceSchedule;
}

/** Fatura só com o que o plano precisa ler. */
export type PlannableInvoice = Pick<
  Invoice,
  'id' | 'year' | 'month' | 'status' | 'closeDate' | 'dueDate'
>;

export interface BillingConfigPlanInput {
  current: InvoiceSchedule;
  next: InvoiceSchedule;
  /** Faturas do banco. Filtrar antes é opcional — o plano decide. */
  invoices: PlannableInvoice[];
  today?: Date;
}

/**
 * Uma fatura só é elegível se era EFETIVAMENTE aberta antes da mudança.
 *
 * O status persistido não basta. O scheduler roda uma vez por dia, então uma
 * fatura pode estar gravada como `OPEN` e já ter passado do fechamento — se o
 * cron não rodou ainda, a coluna está atrasada. Tratar essa linha como aberta
 * reescreveria datas de uma fatura que, no calendário, já fechou: histórico
 * perdido por causa de um estado velho.
 *
 * Por isso o teste combina os dois: o status precisa ser `OPEN` E as datas
 * persistidas precisam confirmar que ela ainda está aberta hoje.
 *
 * `PAID` é terminal e nunca chega aqui como candidata.
 */
function isEffectivelyOpen(invoice: PlannableInvoice, today: Date): boolean {
  if (invoice.status !== 'OPEN') return false;
  return deriveStatusFromInvoiceDates(invoice, today) === 'OPEN';
}

function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function planBillingConfigUpdate(
  input: BillingConfigPlanInput,
): BillingConfigPlan {
  const today = input.today ?? new Date();
  const { current, next } = input;

  const scheduleUnchanged =
    current.invoiceDueDate === next.invoiceDueDate &&
    current.invoiceDueDaysAfterClose === next.invoiceDueDaysAfterClose;

  const changes: InvoiceDateChange[] = [];
  const skipped: SkippedInvoice[] = [];

  if (scheduleUnchanged) {
    return { scheduleUnchanged, changes, skipped, schedule: next };
  }

  for (const invoice of input.invoices) {
    const identity = {
      invoiceId: invoice.id,
      year: invoice.year,
      month: invoice.month,
    };

    // Datas históricas: CLOSED, OVERDUE e PAID nunca são tocadas.
    if (invoice.status !== 'OPEN') {
      skipped.push({ ...identity, reason: 'HISTORICAL_STATUS' });
      continue;
    }

    // Status atrasado: gravada como OPEN, mas o calendário já a fechou.
    if (!isEffectivelyOpen(invoice, today)) {
      skipped.push({ ...identity, reason: 'EFFECTIVELY_CLOSED' });
      continue;
    }

    // A competência (month/year) é preservada — só as datas se movem.
    const nextClose = getInvoiceCloseDateForPeriod(
      next,
      invoice.year,
      invoice.month,
    );
    const nextDue = getInvoiceDueDateForPeriod(
      next,
      invoice.year,
      invoice.month,
    );

    if (
      sameDay(nextClose, invoice.closeDate) &&
      sameDay(nextDue, invoice.dueDate)
    ) {
      // Pode acontecer com clamp: dias 30 e 31 colapsam no mesmo dia em
      // fevereiro. Sem alteração real, não entra no plano nem na contagem que
      // a interface mostra.
      skipped.push({ ...identity, reason: 'NO_DATE_CHANGE' });
      continue;
    }

    const statusAfter = deriveStatusFromInvoiceDates(
      { closeDate: nextClose, dueDate: nextDue },
      today,
    );

    changes.push({
      ...identity,
      closeDate: { before: invoice.closeDate, after: nextClose },
      dueDate: { before: invoice.dueDate, after: nextDue },
      status: { before: invoice.status, after: statusAfter },
      statusChanged: statusAfter !== invoice.status,
    });
  }

  // Ordem cronológica: é como a interface lista, e o que o usuário espera ao
  // ler "próxima fatura".
  changes.sort((a, b) => a.dueDate.after.getTime() - b.dueDate.after.getTime());

  return { scheduleUnchanged, changes, skipped, schedule: next };
}
