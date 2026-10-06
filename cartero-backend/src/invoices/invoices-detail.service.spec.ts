import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from './invoices.service';

describe('InvoicesService.findOne — settlement do detalhe', () => {
  it('mantém total, settlement, category e owner de cada parcela após unlink parcial', async () => {
    const paidAt = new Date('2026-09-21T12:00:00.000Z');
    const transactions = Array.from({ length: 10 }, (_, index) => ({
      id: `tx-${index + 1}`,
      amount: 100,
      person: index === 9 ? { id: 'person-1', name: 'João' } : null,
      category: {
        id: 'category-1',
        name: 'Eletrônicos',
        color: '#123456',
        icon: 'tag',
      },
    }));
    const invoice = {
      id: 'invoice-10x',
      status: 'PAID',
      totalAmount: 1000,
      settlement: { paidAt },
      transactions,
    };
    const findUnique = vi.fn().mockResolvedValue(invoice);
    const service = new InvoicesService(
      { invoice: { findUnique } } as never,
      {} as never,
    );

    const result = await service.findOne(invoice.id, 'user-1');

    expect(
      result.transactions.filter(({ person }) => person === null),
    ).toHaveLength(9);
    expect(result.transactions[9].person).toEqual({
      id: 'person-1',
      name: 'João',
    });
    expect(
      result.transactions.every(
        ({ category }) => category.name === 'Eletrônicos',
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      status: 'PAID',
      totalAmount: 1000,
      settlement: { paidAt },
    });
  });

  it('expõe somente o paidAt da InvoiceSettlement junto ao detalhe', async () => {
    const paidAt = new Date('2026-09-21T12:00:00.000Z');
    const findUnique = vi.fn().mockResolvedValue({
      id: 'invoice-1',
      settlement: { paidAt },
    });
    const service = new InvoicesService(
      { invoice: { findUnique } } as never,
      {} as never,
    );

    const result = await service.findOne('invoice-1', 'user-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'invoice-1', userId: 'user-1' },
      include: expect.objectContaining({
        settlement: { select: { paidAt: true } },
      }),
    });
    expect(result.settlement?.paidAt).toBe(paidAt);
  });

  it('mantém fatura legada compatível quando settlement não existe', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'invoice-legacy', settlement: null });
    const service = new InvoicesService(
      { invoice: { findUnique } } as never,
      {} as never,
    );

    const result = await service.findOne('invoice-legacy', 'user-1');

    expect(result.settlement).toBeNull();
  });
});

describe('InvoicesService.findAll — série parcelada mista', () => {
  it('reclassifica 9/10 parcelas sem alterar o bruto nem o status da fatura', async () => {
    const invoice = {
      id: 'invoice-10x',
      status: 'PAID',
      totalAmount: 1000,
      bank: { id: 'bank-1', name: 'Cartão', isSystem: false },
    };
    const findMany = vi.fn().mockResolvedValue([invoice]);
    const groupBy = vi
      .fn()
      .mockResolvedValue([{ invoiceId: invoice.id, _sum: { amount: 100 } }]);
    const service = new InvoicesService(
      { invoice: { findMany }, transaction: { groupBy } } as never,
      {} as never,
    );

    const [result] = await service.findAll('user-1');

    expect(groupBy).toHaveBeenCalledWith({
      by: ['invoiceId'],
      where: {
        userId: 'user-1',
        invoiceId: { in: [invoice.id] },
        personId: { not: null },
        type: 'CREDIT_CARD',
      },
      _sum: { amount: true },
    });
    expect(result).toMatchObject({
      status: 'PAID',
      totalAmount: 1000,
      reimbursable: 100,
      ownAmount: 900,
    });
    expect(invoice.totalAmount).toBe(1000);
    expect(invoice.status).toBe('PAID');
  });
});
