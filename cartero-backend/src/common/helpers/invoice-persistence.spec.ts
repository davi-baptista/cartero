import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  deriveStatusFromInvoiceDates,
  findOrCreateInvoiceForPeriod,
  getInvoiceCloseDate,
  getInvoiceDueDate,
} from './invoice.helper';
import { USER_ID, makeInvoice } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Datas de fatura persistidas (Fase 6B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra que estes testes fixam: uma fatura calcula as próprias datas UMA
 * VEZ, na criação, e a partir daí elas são fato. Reler a linha não recalcula
 * nada — era esse recálculo a cada leitura que fazia o histórico derivar
 * quando o cartão era reconfigurado.
 */

const SCHEDULE = { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 };
const iso = (date: Date) => date.toISOString().slice(0, 10);

function buildTx(existing: any = null) {
  const created: any[] = [];
  const tx = {
    invoice: {
      findFirst: vi.fn(async () => existing),
      create: vi.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'nova', ...data };
      }),
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, created };
}

describe('findOrCreateInvoiceForPeriod — criação', () => {
  it('persiste closeDate e dueDate calculados na criação', async () => {
    const { tx, created } = buildTx();

    await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      SCHEDULE,
      2026,
      9,
    );

    expect(created).toHaveLength(1);
    expect(iso(created[0].dueDate)).toBe('2026-09-08');
    expect(iso(created[0].closeDate)).toBe('2026-09-01');
  });

  it('grava o status derivado das mesmas datas que está persistindo', async () => {
    // Um segundo cálculo poderia divergir das datas gravadas; derivar delas
    // impede a fatura de nascer com status contraditório.
    const { tx, created } = buildTx();

    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      SCHEDULE,
      2026,
      9,
    );
    vi.useRealTimers();

    // Fecha 01/09, vence 08/09; em 05/09 está fechada e não vencida.
    expect(created[0].status).toBe('CLOSED');
  });

  it('aplica o clamp de fim de mês ao persistir', async () => {
    const { tx, created } = buildTx();

    await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      { invoiceDueDate: 31, invoiceDueDaysAfterClose: 7 },
      2026,
      2,
    );

    expect(iso(created[0].dueDate)).toBe('2026-02-28');
  });

  it('atravessa a virada de ano no fechamento', async () => {
    const { tx, created } = buildTx();

    await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      { invoiceDueDate: 5, invoiceDueDaysAfterClose: 7 },
      2026,
      1,
    );

    expect(iso(created[0].dueDate)).toBe('2026-01-05');
    expect(iso(created[0].closeDate)).toBe('2025-12-29');
  });

  it('nova fatura criada depois da mudança usa a configuração nova', async () => {
    // Item 49: a alteração de ciclo vale prospectivamente.
    const { tx, created } = buildTx();

    await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      { invoiceDueDate: 20, invoiceDueDaysAfterClose: 7 },
      2026,
      10,
    );

    expect(iso(created[0].dueDate)).toBe('2026-10-20');
  });
});

describe('findOrCreateInvoiceForPeriod — fatura existente', () => {
  it('devolve as datas persistidas, sem recalcular', async () => {
    /**
     * O ponto central da fase. A fatura foi criada com vencimento dia 8; o
     * cartão agora está configurado para o dia 25. Reler a fatura tem de
     * devolver 08 — recalcular devolveria 25 e reescreveria o histórico.
     */
    const existing = makeInvoice({
      id: 'antiga',
      month: 9,
      year: 2026,
      status: 'PAID',
      schedule: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
    });
    const { tx, created } = buildTx(existing);

    const invoice = await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      { invoiceDueDate: 25, invoiceDueDaysAfterClose: 7 },
      2026,
      9,
    );

    expect(created).toHaveLength(0);
    expect(iso(invoice.dueDate)).toBe('2026-09-08');
  });

  it('não reescreve o status de uma fatura existente', async () => {
    const existing = makeInvoice({ id: 'paga', status: 'PAID' });
    const { tx } = buildTx(existing);

    const invoice = await findOrCreateInvoiceForPeriod(
      tx,
      USER_ID,
      'bank-1',
      SCHEDULE,
      2026,
      8,
    );

    expect(invoice.status).toBe('PAID');
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});

describe('getInvoiceDueDate / getInvoiceCloseDate — fonte de verdade', () => {
  it('leem o valor persistido, sem depender do banco', async () => {
    // A assinatura antiga recebia o banco e recalculava. Agora recebe só a
    // fatura, o que torna impossível a data derivar da configuração.
    const invoice = makeInvoice({
      month: 9,
      year: 2026,
      schedule: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
    });

    expect(getInvoiceDueDate(invoice)).toBe(invoice.dueDate);
    expect(getInvoiceCloseDate(invoice)).toBe(invoice.closeDate);
  });
});

describe('deriveStatusFromInvoiceDates', () => {
  const invoice = {
    closeDate: new Date(Date.UTC(2026, 8, 1, 3)),
    dueDate: new Date(Date.UTC(2026, 8, 8, 3)),
  };

  it('OPEN antes do fechamento', () => {
    expect(
      deriveStatusFromInvoiceDates(invoice, new Date('2026-08-30T12:00:00Z')),
    ).toBe('OPEN');
  });

  it('CLOSED no próprio dia do fechamento', () => {
    // Fechar hoje já é estar fechada.
    expect(
      deriveStatusFromInvoiceDates(invoice, new Date('2026-09-01T12:00:00Z')),
    ).toBe('CLOSED');
  });

  it('CLOSED no dia do vencimento — vencer hoje não é estar vencida', () => {
    expect(
      deriveStatusFromInvoiceDates(invoice, new Date('2026-09-08T12:00:00Z')),
    ).toBe('CLOSED');
  });

  it('OVERDUE depois do vencimento', () => {
    expect(
      deriveStatusFromInvoiceDates(invoice, new Date('2026-09-09T12:00:00Z')),
    ).toBe('OVERDUE');
  });

  it('ignora a hora de ancoragem — compara dia civil', () => {
    // As datas de fatura são ancoradas em 3h e `parseDateOnly` usa 12h.
    // Comparar instantes crus faria o dia do fechamento parecer já passado.
    const atThree = new Date(Date.UTC(2026, 8, 1, 3));
    const atNoon = new Date(Date.UTC(2026, 8, 1, 12));
    expect(deriveStatusFromInvoiceDates(invoice, atThree)).toBe(
      deriveStatusFromInvoiceDates(invoice, atNoon),
    );
  });
});
