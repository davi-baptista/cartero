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
        debts
          .filter(
            (item) =>
              where.id.in.includes(item.id) &&
              (data.isPaid === false || !item.isPaid),
          )
          .forEach((item) => Object.assign(item, data));
        return { count: 1 };
      }),
    },
    receivable: {
      findMany: vi.fn(async () => receivables.filter((item) => !item.isPaid)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        receivables
          .filter(
            (item) =>
              where.id.in.includes(item.id) &&
              (data.isPaid === false || !item.isPaid),
          )
          .forEach((item) => Object.assign(item, data));
        return { count: 1 };
      }),
    },
    bank: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.id === 'bank-1'
          ? {
              id: 'bank-1',
              userId: USER_ID,
              isSystem: false,
              invoiceDueDate: 8,
              invoiceDueDaysAfterClose: 7,
            }
          : null,
      ),
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
              creditTransaction:
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

  it('does not create individual payment transactions and preserves gross snapshots', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 200)]);
    const result = await h.service.settle('person-1', USER_ID, {} as any);
    expect(result.createdExpenses).toBe(0);
    expect(result.createdIncomes).toBe(0);
    expect(Number(h.groups[0].debts.create[0].amount)).toBe(100);
    expect(Number(h.groups[0].receivables.create[0].amount)).toBe(200);
  });

  it('uses the exact civil settlement date and supports zero-net without a bank', async () => {
    const h = harness([debt('d1', 200)], [receivable('r1', 200)]);
    await h.service.settle('person-1', USER_ID, {
      paymentDate: '2026-08-10',
    } as any);
    expect(h.groups[0].settledAt.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(h.groups[0].bankId).toBeNull();
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

  it('requires a valid method for net outflow', async () => {
    const h = harness([debt('d1', 100)], [receivable('r1', 50)]);
    await expect(
      h.service.settle('person-1', USER_ID, {} as any),
    ).rejects.toThrow(/forma de pagamento/);
    await expect(
      h.service.settle('person-1', USER_ID, { paymentType: 'INCOME' } as any),
    ).rejects.toThrow(/forma de pagamento/);
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
    expect(h.transactions[0].personId).toBeUndefined();
    expect(h.invoices[0].totalAmount).toBe(50);
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
