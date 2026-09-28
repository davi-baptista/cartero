import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from './invoices.service';

describe('InvoicesService.findOne — settlement do detalhe', () => {
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
