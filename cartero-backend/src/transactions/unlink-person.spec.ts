import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeTransaction } from 'src/common/testing/fixtures';

function harness(
  options: {
    count?: number;
    paid?: string[];
    paidInvoice?: boolean;
    otherPerson?: string[];
    failAt?: string;
  } = {},
) {
  const count = options.count ?? 3;
  const transactions = Array.from({ length: count }, (_, index) => ({
    ...makeTransaction({
      id: `tx-${index + 1}`,
      parentId: index === 0 ? null : 'tx-1',
      personId: options.otherPerson?.includes(`tx-${index + 1}`)
        ? 'person-b'
        : 'person-a',
      installmentIndex: index + 1,
      installmentCount: count,
      invoiceId: options.paidInvoice ? 'invoice-paid' : null,
    }),
  }));
  const receivables = transactions.map((transaction) => ({
    id: `r-${transaction.id}`,
    transactionId: transaction.id,
    personId: transaction.personId,
    isPaid: options.paid?.includes(transaction.id) ?? false,
  }));
  const invoice = options.paidInvoice
    ? { id: 'invoice-paid', status: 'PAID', totalAmount: 300 }
    : null;
  const settlement = options.paidInvoice
    ? { id: 'settlement-paid', invoiceId: 'invoice-paid', amount: 300 }
    : null;
  const writes: string[] = [];
  const client: any = {
    transaction: {
      findFirstOrThrow: vi.fn(async ({ where }: any) =>
        transactions.find((item) => item.id === where.id),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: any) =>
        transactions.find((item) => item.id === where.id),
      ),
      findMany: vi.fn(async ({ where }: any) =>
        transactions.filter((item) =>
          where.OR?.some(
            (condition: any) =>
              condition.id === item.id || condition.parentId === item.parentId,
          ),
        ),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        if (options.failAt === where.id) throw new Error('write failed');
        writes.push(where.id);
        const item = transactions.find(
          (candidate) => candidate.id === where.id,
        )!;
        Object.assign(item, data);
        return item;
      }),
    },
    person: { findFirstOrThrow: vi.fn(async () => ({ name: 'João' })) },
    receivable: {
      findMany: vi.fn(async ({ where }: any) =>
        receivables.filter((item) =>
          where.transactionId.in.includes(item.transactionId),
        ),
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          receivables.find(
            (item) => item.transactionId === where.transactionId,
          ) ?? null,
      ),
      delete: vi.fn(async ({ where }: any) => {
        const found = receivables.findIndex((item) => item.id === where.id);
        if (found >= 0) receivables.splice(found, 1);
      }),
    },
    invoice: {
      findMany: vi.fn(async () => (invoice ? [invoice] : [])),
      update: vi.fn(),
    },
    invoiceSettlement: {
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = {
    ...client,
    $transaction: vi.fn(async (callback: (tx: any) => unknown) => {
      const oldTransactions = transactions.map((item) => ({ ...item }));
      const oldReceivables = receivables.map((item) => ({ ...item }));
      try {
        return await callback(client);
      } catch (error) {
        transactions.splice(0, transactions.length, ...oldTransactions);
        receivables.splice(0, receivables.length, ...oldReceivables);
        writes.length = 0;
        throw error;
      }
    }),
  } as unknown as PrismaService;
  const service = new TransactionsService(prisma, {} as any);
  return {
    service,
    transactions,
    receivables,
    invoice,
    settlement,
    writes,
    client,
    prisma,
  };
}

describe('unlink person on purchase source', () => {
  it('updates the transaction and removes its pending receivable through syncLinkedReceivable', async () => {
    const h = harness();
    const preview = await h.service.previewUnlink('tx-1', USER_ID, 'ONE');
    const result = await h.service.unlinkPerson('tx-1', USER_ID, 'ONE', {
      expectedEligibleIds: preview.eligibleIds,
    });
    expect(h.transactions[0].personId).toBeNull();
    expect(h.receivables).toHaveLength(2);
    expect(result.unlinkedIds).toEqual(['tx-1']);
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('allows unlink from a pending receivable on a PAID invoice without writing invoice facts', async () => {
    const h = harness({ paidInvoice: true });
    const invoiceBefore = { ...h.invoice! };
    const settlementBefore = { ...h.settlement! };
    const preview = await h.service.previewUnlink('tx-1', USER_ID, 'ONE');
    expect(preview.eligibleIds).toEqual(['tx-1']);
    expect(preview.paidInvoiceEligibleCount).toBe(1);
    await h.service.unlinkPerson('tx-1', USER_ID, 'ONE', {
      expectedEligibleIds: preview.eligibleIds,
    });
    expect(h.invoice).toEqual(invoiceBefore);
    expect(h.settlement).toEqual(settlementBefore);
    expect(h.client.invoice.update).not.toHaveBeenCalled();
    expect(h.client.invoiceSettlement.update).not.toHaveBeenCalled();
    expect(h.client.invoiceSettlement.delete).not.toHaveBeenCalled();
  });

  it('supports ALL with partial preservation for received and differently linked parcels', async () => {
    const h = harness({ paid: ['tx-2'], otherPerson: ['tx-3'] });
    const preview = await h.service.previewUnlink('tx-1', USER_ID, 'ALL');
    expect(preview.eligibleIds).toEqual(['tx-1']);
    expect(preview.preserved).toEqual([
      { id: 'tx-2', reason: 'RECEIVABLE_ALREADY_PAID' },
      { id: 'tx-3', reason: 'DIFFERENT_PERSON_LINK' },
    ]);
    await h.service.unlinkPerson('tx-1', USER_ID, 'ALL', {
      expectedEligibleIds: preview.eligibleIds,
    });
    expect(h.transactions.map(({ personId }) => personId)).toEqual([
      null,
      'person-a',
      'person-b',
    ]);
    expect(h.receivables.map(({ transactionId }) => transactionId)).toEqual([
      'tx-2',
      'tx-3',
    ]);
  });

  it('ALL unlinks nine pending installments and preserves the received tenth', async () => {
    const h = harness({ count: 10, paid: ['tx-10'] });
    const preview = await h.service.previewUnlink('tx-1', USER_ID, 'ALL');
    expect(preview.eligibleCount).toBe(9);
    expect(preview.preserved).toEqual([
      { id: 'tx-10', reason: 'RECEIVABLE_ALREADY_PAID' },
    ]);
    await h.service.unlinkPerson('tx-1', USER_ID, 'ALL', {
      expectedEligibleIds: preview.eligibleIds,
    });
    expect(
      h.transactions.filter(({ personId }) => personId === null),
    ).toHaveLength(9);
    expect(h.transactions[9].personId).toBe('person-a');
    expect(h.receivables.map(({ transactionId }) => transactionId)).toEqual([
      'tx-10',
    ]);
  });

  it('rejects a stale confirmed set and performs no writes', async () => {
    const h = harness({ paid: ['tx-2'] });
    await expect(
      h.service.unlinkPerson('tx-1', USER_ID, 'ALL', {
        expectedEligibleIds: ['tx-1', 'tx-2', 'tx-3'],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNLINK_SET_CHANGED' }),
    });
    expect(h.writes).toEqual([]);
  });

  it('rejects if the initiating person changed even when eligible ids match', async () => {
    const h = harness();
    await expect(
      h.service.unlinkPerson('tx-1', USER_ID, 'ONE', {
        expectedEligibleIds: ['tx-1'],
        expectedPersonId: 'person-before-preview',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNLINK_SET_CHANGED' }),
    });
    expect(h.writes).toEqual([]);
  });

  it('rolls back if a write fails', async () => {
    const h = harness({ failAt: 'tx-2' });
    const preview = await h.service.previewUnlink('tx-1', USER_ID, 'ALL');
    await expect(
      h.service.unlinkPerson('tx-1', USER_ID, 'ALL', {
        expectedEligibleIds: preview.eligibleIds,
      }),
    ).rejects.toThrow('write failed');
    expect(
      h.transactions.every(({ personId }) => personId === 'person-a'),
    ).toBe(true);
    expect(h.receivables).toHaveLength(3);
  });
});
