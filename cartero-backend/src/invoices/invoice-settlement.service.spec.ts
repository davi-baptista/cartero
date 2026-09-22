import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service';

const invoice = {
  id: 'invoice-1',
  userId: 'user-1',
  bankId: 'card-1',
  month: 9,
  year: 2026,
  status: 'CLOSED' as const,
  totalAmount: new Prisma.Decimal('500.00'),
  closeDate: new Date('2026-09-01T03:00:00.000Z'),
  dueDate: new Date('2026-09-10T03:00:00.000Z'),
};

function buildHarness() {
  const writes = { settlements: [] as any[], invoiceUpdates: [] as any[], deletes: [] as any[] };
  const prisma: any = {
    user: { findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })) },
    invoice: {
      findMany: vi.fn(async () => [invoice]),
      findUnique: vi.fn(async () => ({ ...invoice, status: 'PAID' })),
      update: vi.fn(async (args: any) => { writes.invoiceUpdates.push(args); return args; }),
    },
    invoiceSettlement: {
      create: vi.fn(async (args: any) => { writes.settlements.push(args); return args; }),
      deleteMany: vi.fn(async (args: any) => { writes.deletes.push(args); return { count: 1 }; }),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  const validation = { validateBank: vi.fn(async () => ({ id: 'bank-2', isArchived: false })) };
  return { service: new InvoicesService(prisma, validation as any), prisma, writes };
}

describe('Invoice settlement V1', () => {
  it('cria settlement com total bruto, data civil e banco escolhido antes de PAID', async () => {
    const h = buildHarness();

    await h.service.markManyPaid(
      'user-1',
      { ids: [invoice.id], paymentDate: '2026-09-21', bankId: 'bank-2' },
      'America/Sao_Paulo',
    );

    expect(h.writes.settlements[0].data).toMatchObject({
      invoiceId: invoice.id,
      amount: invoice.totalAmount,
      paidAt: new Date('2026-09-21T12:00:00.000Z'),
      bankId: 'bank-2',
    });
    expect(h.writes.invoiceUpdates[0].data).toEqual({ status: 'PAID' });
    expect(h.writes.settlements[0].data.amount).toEqual(invoice.totalAmount);
  });

  it('rejeita data futura sem escrever settlement ou status', async () => {
    const h = buildHarness();

    await expect(h.service.markManyPaid(
      'user-1',
      { ids: [invoice.id], paymentDate: '2999-01-01' },
      'America/Sao_Paulo',
    )).rejects.toMatchObject({ response: { code: 'SETTLEMENT_DATE_IN_FUTURE' } });

    expect(h.writes.settlements).toHaveLength(0);
    expect(h.writes.invoiceUpdates).toHaveLength(0);
  });

  it('reopen remove settlement e deriva status na mesma transação', async () => {
    const h = buildHarness();

    await h.service.reopen('invoice-1', 'user-1', 'America/Sao_Paulo');

    expect(h.writes.deletes).toEqual([{ where: { invoiceId: 'invoice-1' } }]);
    expect(h.writes.invoiceUpdates[0].data.status).toBe('OVERDUE');
  });
});
