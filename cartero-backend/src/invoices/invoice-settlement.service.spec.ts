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

function buildHarness(
  claimCount = 1,
  canonicalTransactionId: string | null = null,
) {
  const writes = {
    settlements: [] as any[],
    invoiceUpdates: [] as any[],
    deletes: [] as any[],
  };
  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    bank: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'system-bank', ...data })),
    },
    invoice: {
      findMany: vi.fn(async () => [invoice]),
      findUnique: vi.fn(async () => ({ ...invoice, status: 'PAID' })),
      update: vi.fn(async (args: any) => {
        writes.invoiceUpdates.push(args);
        return args;
      }),
      updateMany: vi.fn(async () => ({ count: claimCount })),
    },
    transaction: {
      create: vi.fn(async (args: any) => ({
        id: 'transaction-1',
        ...args.data,
      })),
      delete: vi.fn(),
    },
    invoiceSettlement: {
      findMany: vi.fn(async () =>
        canonicalTransactionId
          ? [{ transactionId: canonicalTransactionId }]
          : [],
      ),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: any) => {
        writes.settlements.push(args);
        return { id: 'settlement-1', ...args.data };
      }),
      update: vi.fn(async (args: any) => args),
      deleteMany: vi.fn(async (args: any) => {
        writes.deletes.push(args);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $queryRaw: undefined,
  };
  const validation = {
    validateBank: vi.fn(async () => ({ id: 'bank-2', isArchived: false })),
    findOrCreateSystemCategory: vi.fn(async () => ({
      id: 'category-invoice-payment',
    })),
  };
  return {
    service: new InvoicesService(prisma, validation as any),
    prisma,
    writes,
  };
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
    expect(h.prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INVOICE_PAYMENT',
          title: 'Pagamento de fatura',
          categoryId: 'category-invoice-payment',
        }),
      }),
    );
    expect(h.prisma.invoiceSettlement.update).toHaveBeenCalled();
    expect(h.writes.settlements[0].data.amount).toEqual(invoice.totalAmount);
  });

  it('rejeita data futura sem escrever settlement ou status', async () => {
    const h = buildHarness();

    await expect(
      h.service.markManyPaid(
        'user-1',
        { ids: [invoice.id], paymentDate: '2999-01-01' },
        'America/Sao_Paulo',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SETTLEMENT_DATE_IN_FUTURE' },
    });

    expect(h.writes.settlements).toHaveLength(0);
    expect(h.writes.invoiceUpdates).toHaveLength(0);
  });

  it('reopen remove settlement e deriva status na mesma transação', async () => {
    const h = buildHarness();

    await h.service.reopen('invoice-1', 'user-1', 'America/Sao_Paulo');

    expect(h.writes.deletes).toEqual([{ where: { invoiceId: 'invoice-1' } }]);
    expect(h.writes.invoiceUpdates[0].data.status).toBe('OVERDUE');
  });

  it('reopen remove a Transaction canônica vinculada no mesmo fluxo', async () => {
    const h = buildHarness(1, 'canonical-transaction-1');

    await h.service.reopen('invoice-1', 'user-1', 'America/Sao_Paulo');

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.transaction.delete).toHaveBeenCalledTimes(1);
    expect(h.prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'canonical-transaction-1', userId: 'user-1' },
    });
    expect(h.writes.deletes).toEqual([{ where: { invoiceId: 'invoice-1' } }]);
    expect(h.writes.invoiceUpdates[0].data.status).toBe('OVERDUE');
  });

  it('sem banco usa o banco sistêmico na Transaction canônica', async () => {
    const h = buildHarness();

    await h.service.markManyPaid(
      'user-1',
      { ids: [invoice.id], paymentDate: '2026-09-21' },
      'America/Sao_Paulo',
    );

    expect(h.prisma.bank.create).toHaveBeenCalled();
    expect(h.prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankId: 'system-bank' }),
      }),
    );
  });

  it('retry sem claim não cria settlement nem Transaction novamente', async () => {
    const h = buildHarness(0);

    await h.service.markManyPaid(
      'user-1',
      { ids: [invoice.id], paymentDate: '2026-09-21' },
      'America/Sao_Paulo',
    );

    expect(h.prisma.invoiceSettlement.create).not.toHaveBeenCalled();
    expect(h.prisma.transaction.create).not.toHaveBeenCalled();
    expect(h.prisma.invoiceSettlement.findUnique).toHaveBeenCalled();
  });
});
