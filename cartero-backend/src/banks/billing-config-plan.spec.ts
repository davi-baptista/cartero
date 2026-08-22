import { describe, expect, it } from 'vitest';
import { planBillingConfigUpdate } from './billing-config-plan.helper';
import {
  getInvoiceCloseDateForPeriod,
  getInvoiceDueDateForPeriod,
} from 'src/common/helpers/invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Plano de alteração do ciclo de faturamento (Fase 6B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O defeito estrutural que esta fase corrige: as datas de fechamento e
 * vencimento eram derivadas da configuração ATUAL do banco a cada leitura, e
 * portanto mudar o vencimento do cartão reescrevia as datas de todo o
 * histórico — inclusive de faturas já pagas.
 *
 * A política agora tem duas metades:
 *
 * - `CLOSED`, `OVERDUE` e `PAID` são fatos. Nenhuma reconfiguração as move.
 * - `OPEN` pertence a um ciclo não encerrado e acompanha a nova configuração,
 *   porque um parcelamento em 10x materializa faturas futuras de imediato.
 *
 * O plano é puro para que a prévia e o save partam da mesma decisão.
 */

const SCHEDULE_8 = { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 };
const SCHEDULE_15 = { invoiceDueDate: 15, invoiceDueDaysAfterClose: 7 };

/** Fatura com as datas que a configuração indicada produziria. */
function invoiceAt(
  id: string,
  year: number,
  month: number,
  status: 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID',
  schedule = SCHEDULE_8,
) {
  return {
    id,
    year,
    month,
    status,
    closeDate: getInvoiceCloseDateForPeriod(schedule, year, month),
    dueDate: getInvoiceDueDateForPeriod(schedule, year, month),
  };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('planBillingConfigUpdate — datas históricas são imutáveis', () => {
  it('não altera fatura PAID', () => {
    const paid = invoiceAt('paid', 2026, 8, 'PAID');

    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [paid],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped).toEqual([
      {
        invoiceId: 'paid',
        year: 2026,
        month: 8,
        reason: 'HISTORICAL_STATUS',
      },
    ]);
  });

  it('não altera fatura CLOSED', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('closed', 2026, 8, 'CLOSED')],
      today: new Date('2026-08-05T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('HISTORICAL_STATUS');
  });

  it('não altera fatura OVERDUE', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('overdue', 2026, 7, 'OVERDUE')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('HISTORICAL_STATUS');
  });

  it('duas alterações seguidas não movem a fatura congelada', () => {
    // 8 → 15 → 20. A fatura histórica precisa continuar em 08/08 nas duas.
    const closed = invoiceAt('closed', 2026, 8, 'CLOSED');
    const original = closed.dueDate;

    const first = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [closed],
      today: new Date('2026-08-20T12:00:00Z'),
    });
    const second = planBillingConfigUpdate({
      current: SCHEDULE_15,
      next: { invoiceDueDate: 20, invoiceDueDaysAfterClose: 7 },
      invoices: [closed],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(first.changes).toHaveLength(0);
    expect(second.changes).toHaveLength(0);
    expect(closed.dueDate).toBe(original);
    expect(iso(closed.dueDate)).toBe('2026-08-08');
  });
});

describe('planBillingConfigUpdate — OPEN acompanha a nova configuração', () => {
  it('move as datas de uma fatura em aberto', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('open', 2026, 9, 'OPEN')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0];
    expect(iso(change.dueDate.before)).toBe('2026-09-08');
    expect(iso(change.dueDate.after)).toBe('2026-09-15');
    // Fechamento acompanha: 15/09 − 7 dias.
    expect(iso(change.closeDate.after)).toBe('2026-09-08');
  });

  it('preserva a competência — só as datas se movem', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('open', 2026, 9, 'OPEN')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes[0].year).toBe(2026);
    expect(plan.changes[0].month).toBe(9);
  });

  it('recalcula o fechamento quando só o intervalo muda', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 15 },
      invoices: [invoiceAt('open', 2026, 9, 'OPEN')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    const change = plan.changes[0];
    // Vencimento intacto, fechamento 15 dias antes.
    expect(iso(change.dueDate.after)).toBe('2026-09-08');
    expect(iso(change.closeDate.after)).toBe('2026-08-24');
  });

  it('todas as faturas futuras de um parcelamento acompanham', () => {
    // O caso que motiva mover OPEN: 10x cria faturas futuras de imediato.
    const invoices = Array.from({ length: 10 }, (_, i) => {
      const month = ((9 + i - 1) % 12) + 1;
      const year = 2026 + Math.floor((9 + i - 1) / 12);
      return invoiceAt(`p${i}`, year, month, 'OPEN');
    });

    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices,
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(10);
    expect(plan.changes.every((c) => c.dueDate.after.getUTCDate() === 15)).toBe(
      true,
    );
  });

  it('as mudanças saem em ordem cronológica', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [
        invoiceAt('nov', 2026, 11, 'OPEN'),
        invoiceAt('set', 2026, 9, 'OPEN'),
        invoiceAt('out', 2026, 10, 'OPEN'),
      ],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes.map((c) => c.month)).toEqual([9, 10, 11]);
  });
});

describe('planBillingConfigUpdate — status derivado após a mudança', () => {
  it('OPEN que passa a estar fechada muda de status na hora', () => {
    // Hoje 20/08. A fatura de agosto fechava 01/08 pela config antiga? Não:
    // usamos setembro, cujo fechamento cai em 01/09 com due 08. Com due 15 o
    // fechamento vai para 08/09 — ainda futuro. Para forçar o fechamento
    // imediato, o intervalo encurta bastante.
    const plan = planBillingConfigUpdate({
      current: { invoiceDueDate: 25, invoiceDueDaysAfterClose: 5 },
      next: { invoiceDueDate: 25, invoiceDueDaysAfterClose: 30 },
      invoices: [
        invoiceAt('open', 2026, 9, 'OPEN', {
          invoiceDueDate: 25,
          invoiceDueDaysAfterClose: 5,
        }),
      ],
      today: new Date('2026-08-27T12:00:00Z'),
    });

    const change = plan.changes[0];
    // Fechamento passa de 20/09 para 26/08 — já passou.
    expect(iso(change.closeDate.before)).toBe('2026-09-20');
    expect(iso(change.closeDate.after)).toBe('2026-08-26');
    expect(change.status.after).toBe('CLOSED');
    expect(change.statusChanged).toBe(true);
  });

  it('OPEN cujo novo vencimento já passou vira OVERDUE', () => {
    const plan = planBillingConfigUpdate({
      current: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 7 },
      next: { invoiceDueDate: 5, invoiceDueDaysAfterClose: 3 },
      invoices: [
        invoiceAt('open', 2026, 8, 'OPEN', {
          invoiceDueDate: 28,
          invoiceDueDaysAfterClose: 7,
        }),
      ],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    const change = plan.changes[0];
    expect(iso(change.dueDate.after)).toBe('2026-08-05');
    expect(change.status.after).toBe('OVERDUE');
    expect(change.statusChanged).toBe(true);
  });

  it('OPEN que continua aberta mantém o status', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('open', 2026, 12, 'OPEN')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.changes[0].status.after).toBe('OPEN');
    expect(plan.changes[0].statusChanged).toBe(false);
  });

  it('nunca reabre histórico: CLOSED não volta para OPEN', () => {
    // A nova configuração produziria datas futuras para esta competência, o
    // que daria OPEN se ela fosse recalculada. Não é — nem entra no plano.
    const plan = planBillingConfigUpdate({
      current: { invoiceDueDate: 5, invoiceDueDaysAfterClose: 3 },
      next: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 3 },
      invoices: [
        invoiceAt('closed', 2026, 8, 'CLOSED', {
          invoiceDueDate: 5,
          invoiceDueDaysAfterClose: 3,
        }),
      ],
      today: new Date('2026-08-10T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('HISTORICAL_STATUS');
  });
});

describe('planBillingConfigUpdate — status persistido atrasado', () => {
  it('não reescreve fatura gravada como OPEN que já fechou de fato', () => {
    /**
     * O cron roda uma vez por dia. Entre o fechamento e a execução seguinte, a
     * coluna `status` fica atrasada: diz OPEN quando o calendário já fechou.
     *
     * Confiar só na coluna faria a alteração reescrever as datas de uma fatura
     * que, de fato, já é histórica — perda de dado por causa de um estado
     * velho. Por isso a elegibilidade exige status OPEN E datas que confirmem.
     */
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      // Fatura de agosto: fecha 01/08. Hoje é 10/08 e o cron não rodou.
      invoices: [invoiceAt('stale', 2026, 8, 'OPEN')],
      today: new Date('2026-08-10T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('EFFECTIVELY_CLOSED');
  });

  it('fatura gravada como OPEN e ainda aberta é elegível', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: SCHEDULE_15,
      invoices: [invoiceAt('fresh', 2026, 10, 'OPEN')],
      today: new Date('2026-08-10T12:00:00Z'),
    });

    expect(plan.changes).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });
});

describe('planBillingConfigUpdate — sem mudança real', () => {
  it('configuração idêntica não produz plano', () => {
    const plan = planBillingConfigUpdate({
      current: SCHEDULE_8,
      next: { ...SCHEDULE_8 },
      invoices: [invoiceAt('open', 2026, 10, 'OPEN')],
      today: new Date('2026-08-20T12:00:00Z'),
    });

    expect(plan.scheduleUnchanged).toBe(true);
    expect(plan.changes).toHaveLength(0);
  });

  it('clamp que colapsa no mesmo dia não conta como alteração', () => {
    // Dias 30 e 31 caem ambos em 28 de fevereiro; a fatura não muda de data,
    // então não deve inflar a contagem que a interface mostra.
    const plan = planBillingConfigUpdate({
      current: { invoiceDueDate: 30, invoiceDueDaysAfterClose: 7 },
      next: { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      invoices: [
        invoiceAt('fev', 2027, 2, 'OPEN', {
          invoiceDueDate: 30,
          invoiceDueDaysAfterClose: 7,
        }),
      ],
      today: new Date('2027-01-05T12:00:00Z'),
    });

    expect(plan.scheduleUnchanged).toBe(false);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('NO_DATE_CHANGE');
  });
});

describe('Datas persistidas — clamp e bordas de calendário', () => {
  it('dia 31 em fevereiro comum vira 28', () => {
    const due = getInvoiceDueDateForPeriod(
      { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      2026,
      2,
    );
    expect(iso(due)).toBe('2026-02-28');
  });

  it('dia 31 em fevereiro bissexto vira 29', () => {
    const due = getInvoiceDueDateForPeriod(
      { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      2024,
      2,
    );
    expect(iso(due)).toBe('2024-02-29');
  });

  it('dia 31 em mês de 30 dias vira 30', () => {
    const due = getInvoiceDueDateForPeriod(
      { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      2026,
      4,
    );
    expect(iso(due)).toBe('2026-04-30');
  });

  it('fechamento atravessa a virada de ano', () => {
    // Fatura de janeiro que vence dia 5 fecha em dezembro do ano anterior.
    const close = getInvoiceCloseDateForPeriod(
      { invoiceDueDate: 5, invoiceDueDaysAfterClose: 7 },
      2026,
      1,
    );
    expect(iso(close)).toBe('2025-12-29');
  });

  it('intervalo longo pode jogar o fechamento para o mês anterior', () => {
    const close = getInvoiceCloseDateForPeriod(
      { invoiceDueDate: 1, invoiceDueDaysAfterClose: 31 },
      2026,
      1,
    );
    expect(iso(close)).toBe('2025-12-01');
  });

  it('intervalo zero é elevado ao mínimo de 1 dia', () => {
    const due = getInvoiceDueDateForPeriod(
      { invoiceDueDate: 1, invoiceDueDaysAfterClose: 0 },
      2026,
      3,
    );
    const close = getInvoiceCloseDateForPeriod(
      { invoiceDueDate: 1, invoiceDueDaysAfterClose: 0 },
      2026,
      3,
    );
    expect(iso(due)).toBe('2026-03-01');
    expect(iso(close)).toBe('2026-02-28');
  });
});
