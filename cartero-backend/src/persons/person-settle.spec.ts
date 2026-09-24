import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';

const debt = (id: string, amount: number) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  amount: money(amount),
  isPaid: false,
  paidAt: null,
  paymentTransactionId: null,
  dueDate: new Date('2026-08-01T12:00:00Z'),
  occurredAt: new Date('2026-08-01T12:00:00Z'),
  title: id,
  creditorName: 'Eva',
});
const receivable = (id: string, amount: number) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  amount: money(amount),
  isPaid: false,
  paidAt: null,
  paymentTransactionId: null,
  transactionId: null,
  dueDate: new Date('2026-08-01T12:00:00Z'),
  occurredAt: new Date('2026-08-01T12:00:00Z'),
  title: id,
  debtorName: 'Eva',
});

function harness(debts: any[], receivables: any[]) {
  const groups: any[] = [];
  const transactions: any[] = [];
  const invoices: any[] = [];
  const prisma: any = {
    $queryRaw: vi.fn(async () => []),
    person: {
      findUnique: vi.fn(async () => ({
        id: 'person-1',
        userId: USER_ID,
        name: 'Eva',
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    debt: {
      findMany: vi.fn(async () => debts.filter((item) => !item.isPaid)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matching = debts.filter(
          (item) =>
            where.id.in.includes(item.id) &&
            (data.isPaid === false || !item.isPaid),
        );
        matching.forEach((item) => Object.assign(item, data));
        return { count: matching.length };
      }),
    },
    receivable: {
      findMany: vi.fn(async () => receivables.filter((item) => !item.isPaid)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matching = receivables.filter(
          (item) =>
            where.id.in.includes(item.id) &&
            (data.isPaid === false || !item.isPaid),
        );
        matching.forEach((item) => Object.assign(item, data));
        return { count: matching.length };
      }),
    },
    bank: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (!['bank-1', 'bank-system', 'bank-archived'].includes(where.id))
          return null;
        return {
          id: where.id,
          userId: USER_ID,
          isSystem: where.id === 'bank-system',
          isArchived: where.id === 'bank-archived',
          invoiceDueDate: 8,
          invoiceDueDaysAfterClose: 7,
        };
      }),
      findFirst: vi.fn(async () => ({
        id: 'no-bank',
        userId: USER_ID,
        isSystem: true,
      })),
    },
    category: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({
        id: 'cat-settlement',
        ...data,
      })),
    },
    invoice: {
      findFirst: vi.fn(async () => invoices[0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        const invoice = {
          id: `invoice-${invoices.length + 1}`,
          totalAmount: 0,
          status: 'OPEN',
          ...data,
        };
        invoices.push(invoice);
        return invoice;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const invoice = invoices.find((item) => item.id === where.id);
        if (data.totalAmount?.increment)
          invoice.totalAmount += Number(data.totalAmount.increment);
        if (data.totalAmount?.decrement)
          invoice.totalAmount -= Number(data.totalAmount.decrement);
        return invoice;
      }),
      findUnique: vi.fn(
        async ({ where }: any) =>
          invoices.find((item) => item.id === where.id) ?? null,
      ),
      delete: vi.fn(async ({ where }: any) => {
        const index = invoices.findIndex((item) => item.id === where.id);
        if (index >= 0) invoices.splice(index, 1);
      }),
    },
    transaction: {
      create: vi.fn(async ({ data }: any) => {
        const transaction = { id: `tx-${transactions.length + 1}`, ...data };
        transactions.push(transaction);
        return transaction;
      }),
      findUnique: vi.fn(
        async ({ where }: any) =>
          transactions.find((item) => item.id === where.id) ?? null,
      ),
      delete: vi.fn(async ({ where }: any) => {
        const index = transactions.findIndex((item) => item.id === where.id);
        if (index >= 0) transactions.splice(index, 1);
      }),
    },
    personSettlementGroup: {
      create: vi.fn(async ({ data }: any) => {
        const group = {
          id: `group-${groups.length + 1}`,
          ...data,
          status: 'ACTIVE',
        };
        groups.push(group);
        return group;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const group = groups.find(
          (g) =>
            g.id === where.id &&
            g.userId === where.userId &&
            g.status === 'ACTIVE',
        );
        return group
          ? {
              ...group,
              settlementTransaction:
                transactions.find(
                  (item) => item.personSettlementGroupId === group.id,
                ) ?? null,
              debts: group.debts.create.map((item: any) => ({
                debtId: item.debtId,
              })),
              receivables: group.receivables.create.map((item: any) => ({
                receivableId: item.receivableId,
              })),
            }
          : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const group = groups.find((g) => g.id === where.id);
        Object.assign(group, data);
        return group;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const service = new PersonsService(
    prisma as PrismaService,
    new EntityValidationService(prisma as PrismaService),
  );
  return {
    service,
    prisma,
    groups,
    debts,
    receivables,
    transactions,
    invoices,
  };
}

describe('CM1C person settlement groups', () => {
  it.each([
    [100, 200, 'INFLOW', 100],
    [500, 200, 'OUTFLOW', 300],
    [200, 200, 'NONE', 0],
  ])(
    'calculates net direction for debt %s and receivable %s',
    async (debtAmount, receivableAmount, direction, net) => {
      const h = harness(
        [debt('d1', debtAmount)],
        [receivable('r1', receivableAmount)],
      );
      const result = await h.service.settle('person-1', USER_ID, {
        paymentDate: '2026-08-10',
        ...(direction === 'OUTFLOW' ? { paymentType: 'PIX' } : {}),
      } as any);
      expect(result.group!.direction).toBe(direction);
      expect(Number(result.group!.netAmount)).toBe(net);
      expect(h.groups[0].debts.create).toHaveLength(1);
      expect(h.debts[0].isPaid).toBe(true);
      expect(h.receivables[0].isPaid).toBe(true);
    },
  );

  it('aggregates multiple members into one canonical transaction and preserves origin links', async () => {
    const h = harness(
      [debt('d1', 100), debt('d2', 25)],
      [receivable('r1', 200), receivable('r2', 25)],
    );
    h.receivables[0].transactionId = 'source-purchase-1';
    const result = await h.service.settle('person-1', USER_ID, {} as any);
    expect(result.createdExpenses).toBe(0);
    expect(result.createdIncomes).toBe(0);
    expect(h.groups[0].debts.create).toHaveLength(2);
    expect(h.groups[0].receivables.create).toHaveLength(2);
    expect(h.transactions).toHaveLength(1);
    expect(Number(h.transactions[0].amount)).toBe(
      Number(result.group!.netAmount),
    );
    expect(h.receivables[0].transactionId).toBe('source-purchase-1');
    expect(
      h.receivables.every((item) => item.paymentTransactionId === null),
    ).toBe(true);
    await h.service.undoSettlement(result.group!.id, USER_ID);
    expect(h.transactions).toHaveLength(0);
    expect(h.receivables[0].transactionId).toBe('source-purchase-1');
  });

  it('uses the exact civil settlement date and supports zero-net without a bank', async () => {
    const h = harness([debt('d1', 200)], [receivable('r1', 200)]);
    await h.service.settle('person-1', USER_ID, {
      paymentDate: '2026-08-10',
    } as any);
    expect(h.groups[0].settledAt.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(h.groups[0].bankId).toBeNull();
    expect(h.transactions).toHaveLength(0);
    await h.service.undoSettlement(h.groups[0].id, USER_ID);
    expect(h.transactions).toHaveLength(0);
    expect(h.debts[0].isPaid).toBe(false);
    expect(h.receivables[0].isPaid).toBe(false);
  });

  it('undoes the whole group and permits re-settlement', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 200)]);
    const first = await h.service.settle('person-1', USER_ID, {} as any);
    await h.service.undoSettlement(first.group!.id, USER_ID);
    expect(h.debts[0].isPaid).toBe(false);
    expect(h.receivables[0].isPaid).toBe(false);
    const second = await h.service.settle('person-1', USER_ID, {} as any);
    expect(second.group!.id).not.toBe(first.group!.id);
  });

  it.each(['INFLOW', 'PIX', 'DEBIT_CARD', 'BOLETO'] as const)(
    'reverses and re-settles a canonical %s movement exactly once',
    async (kind) => {
      const inflow = kind === 'INFLOW';
      const h = harness(
        inflow ? [] : [debt('d1', 100)],
        inflow ? [receivable('r1', 100)] : [],
      );
      const payload = inflow
        ? {}
        : { paymentType: kind, paymentBankId: undefined };
      const first = await h.service.settle('person-1', USER_ID, payload as any);
      expect(h.transactions).toHaveLength(1);
      await h.service.undoSettlement(first.group!.id, USER_ID);
      expect(h.transactions).toHaveLength(0);
      expect(h.debts.every((item) => !item.isPaid)).toBe(true);
      expect(h.receivables.every((item) => !item.isPaid)).toBe(true);
      const second = await h.service.settle(
        'person-1',
        USER_ID,
        payload as any,
      );
      expect(second.group!.id).not.toBe(first.group!.id);
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].personSettlementGroupId).toBe(second.group!.id);
    },
  );

  it('requires a valid method for net outflow', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    await expect(
      h.service.settle('person-1', USER_ID, {} as any),
    ).rejects.toThrow(/pagamento/);
    await expect(
      h.service.settle('person-1', USER_ID, { paymentType: 'INCOME' } as any),
    ).rejects.toThrow(/pagamento/);
  });

  it('creates one net credit artifact linked to the group', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    const result = await h.service.settle('person-1', USER_ID, {
      paymentDate: '2026-08-10',
      paymentType: 'CREDIT_CARD',
      paymentBankId: 'bank-1',
    } as any);

    expect(result.group!.direction).toBe('OUTFLOW');
    expect(result.group!.paymentType).toBe('CREDIT_CARD');
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0]).toMatchObject({
      type: 'CREDIT_CARD',
      bankId: 'bank-1',
      personSettlementGroupId: result.group!.id,
      categoryId: 'cat-settlement',
    });
    expect(Number(h.transactions[0].amount)).toBe(50);
    expect(h.transactions[0].personId).toBe('person-1');
    expect(h.invoices[0].totalAmount).toBe(50);
  });

  it.each(['PIX', 'DEBIT_CARD', 'BOLETO'] as const)(
    'creates one canonical transaction for direct group outflow with %s',
    async (paymentType) => {
      const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
      const result = await h.service.settle('person-1', USER_ID, {
        paymentType,
        paymentDate: '2026-08-10',
      } as any);

      expect(result.group!.paymentType).toBe(paymentType);
      expect(result.group!.direction).toBe('OUTFLOW');
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0]).toMatchObject({
        type: paymentType,
        personId: 'person-1',
        personSettlementGroupId: result.group!.id,
        bankId: 'no-bank',
      });
    },
  );

  it.each([true, false])(
    'creates one canonical inflow transaction (bank selected: %s)',
    async (withBank) => {
      const h = harness([], [receivable('r1', 200)]);
      const result = await h.service.settle('person-1', USER_ID, {
        ...(withBank ? { paymentBankId: 'bank-1' } : {}),
      } as any);
      expect(result.group!.direction).toBe('INFLOW');
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0]).toMatchObject({
        type: 'INCOME',
        amount: money(200),
        personId: 'person-1',
        personSettlementGroupId: result.group!.id,
        bankId: withBank ? 'bank-1' : 'no-bank',
      });
    },
  );

  it.each(['PIX', 'DEBIT_CARD', 'BOLETO'] as const)(
    'uses the selected bank for %s settlement',
    async (paymentType) => {
      const h = harness([debt('d1', 200)], []);
      const result = await h.service.settle('person-1', USER_ID, {
        paymentType,
        paymentBankId: 'bank-1',
      } as any);
      expect(result.group!.direction).toBe('OUTFLOW');
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].bankId).toBe('bank-1');
    },
  );

  it('rejects payment type on inflow and zero-net groups', async () => {
    const inflow = harness([debt('d1', 100)], [receivable('r1', 200)]);
    await expect(
      inflow.service.settle('person-1', USER_ID, { paymentType: 'PIX' } as any),
    ).rejects.toThrow(/pagamento/);

    const none = harness([debt('d1', 100)], [receivable('r1', 100)]);
    const noneResult = await none.service.settle(
      'person-1',
      USER_ID,
      {} as any,
    );
    expect(noneResult.group!.direction).toBe('NONE');
    expect(none.transactions).toHaveLength(0);
  });

  it.each([
    ['missing bank', undefined],
    ['system bank', 'bank-system'],
    ['archived bank', 'bank-archived'],
  ])('rejects credit group outflow with %s', async (_case, paymentBankId) => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    await expect(
      h.service.settle('person-1', USER_ID, {
        paymentType: 'CREDIT_CARD',
        ...(paymentBankId ? { paymentBankId } : {}),
      } as any),
    ).rejects.toThrow(/banco/);
    expect(h.groups).toHaveLength(0);
    expect(h.transactions).toHaveLength(0);
  });

  it('removes the exact credit artifact on group undo', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    const result = await h.service.settle('person-1', USER_ID, {
      paymentType: 'CREDIT_CARD',
      paymentBankId: 'bank-1',
    } as any);

    await h.service.undoSettlement(result.group!.id, USER_ID);

    expect(h.transactions).toHaveLength(0);
    expect(h.invoices[0]?.totalAmount ?? 0).toBe(0);
    expect(h.groups[0].status).toBe('REVERSED');
  });

  it('re-settles credit after undo without a stale relation or ghost invoice amount', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    const first = await h.service.settle('person-1', USER_ID, {
      paymentType: 'CREDIT_CARD',
      paymentBankId: 'bank-1',
    } as any);
    expect(h.transactions).toHaveLength(1);
    expect(h.invoices[0].totalAmount).toBe(50);

    await h.service.undoSettlement(first.group!.id, USER_ID);
    expect(h.transactions).toHaveLength(0);
    expect(h.invoices).toHaveLength(0);
    expect(h.groups[0].status).toBe('REVERSED');
    expect(h.debts[0].isPaid).toBe(false);
    expect(h.receivables[0].isPaid).toBe(false);

    const second = await h.service.settle('person-1', USER_ID, {
      paymentType: 'CREDIT_CARD',
      paymentBankId: 'bank-1',
    } as any);
    expect(second.group!.status).toBe('ACTIVE');
    expect(second.group!.id).not.toBe(first.group!.id);
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].personSettlementGroupId).toBe(second.group!.id);
    expect(h.invoices[0].totalAmount).toBe(50);
  });

  it('blocks credit group undo while its Invoice is paid', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    const result = await h.service.settle('person-1', USER_ID, {
      paymentType: 'CREDIT_CARD',
      paymentBankId: 'bank-1',
    } as any);
    h.invoices[0].status = 'PAID';

    await expect(
      h.service.undoSettlement(result.group!.id, USER_ID),
    ).rejects.toThrow(/fatura já paga/);
    expect(h.transactions).toHaveLength(1);
    expect(h.groups[0].status).toBe('ACTIVE');
  });
});
