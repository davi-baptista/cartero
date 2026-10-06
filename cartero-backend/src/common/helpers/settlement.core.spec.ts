import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { removeSettlementTransaction } from './settlement.core';

describe('removeSettlementTransaction', () => {
  it('preserves a settlement transaction in a PAID invoice', async () => {
    const tx = {
      transaction: {
        findUnique: vi.fn(async () => ({
          id: 'payment-1',
          invoiceId: 'invoice-1',
          amount: 50,
        })),
        delete: vi.fn(),
      },
      invoice: {
        findUnique: vi.fn(async () => ({ status: 'PAID' })),
        update: vi.fn(),
      },
    } as any;

    await expect(
      removeSettlementTransaction(tx, 'user-1', 'payment-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.transaction.delete).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });
});
