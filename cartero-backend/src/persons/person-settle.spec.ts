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
      findFirst: vi.fn(async () => ({
        id: 'no-bank',
        userId: USER_ID,
        isSystem: true,
      })),
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
  return { service, prisma, groups, debts, receivables };
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
      } as any);
      expect(result.group.direction).toBe(direction);
      expect(Number(result.group.netAmount)).toBe(net);
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
    await h.service.undoSettlement(first.group.id, USER_ID);
    expect(h.debts[0].isPaid).toBe(false);
    expect(h.receivables[0].isPaid).toBe(false);
    const second = await h.service.settle('person-1', USER_ID, {} as any);
    expect(second.group.id).not.toBe(first.group.id);
  });
});
