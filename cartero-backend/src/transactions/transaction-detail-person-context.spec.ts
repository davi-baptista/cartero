import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';

describe('transaction read model person context', () => {
  it('returns the same minimal receipt-person relation in list and detail reads', async () => {
    const transaction = { id: 'tx-person-receipt', userId: 'user-1' };
    type Relation = {
      select: { person: { select: { id: true; name: true } } };
    };
    type QueryArgs = {
      include?: { paymentReceivable?: Relation; paymentDebt?: Relation };
    };
    const findMany = vi.fn(async (args: QueryArgs) => {
      void args;
      return [transaction];
    });
    const findUniqueOrThrow = vi.fn(async (args: QueryArgs) => {
      void args;
      return transaction;
    });
    const service = new TransactionsService(
      {
        transaction: { findMany, findUniqueOrThrow },
      } as any,
      {
        validateTransaction: vi.fn(async () => transaction),
      } as any,
    );

    await service.findAll('user-1');
    await service.findOne(transaction.id, 'user-1');

    const listRelation = findMany.mock.calls[0]?.[0].include?.paymentReceivable;
    const detailRelation =
      findUniqueOrThrow.mock.calls[0]?.[0].include?.paymentReceivable;
    const listDebtRelation = findMany.mock.calls[0]?.[0].include?.paymentDebt;
    const detailDebtRelation =
      findUniqueOrThrow.mock.calls[0]?.[0].include?.paymentDebt;
    expect(listRelation).toEqual(detailRelation);
    expect(listRelation).toEqual({
      select: { person: { select: { id: true, name: true } } },
    });
    expect(listDebtRelation).toEqual(detailDebtRelation);
    expect(listDebtRelation).toEqual({
      select: { person: { select: { id: true, name: true } } },
    });
  });
});
