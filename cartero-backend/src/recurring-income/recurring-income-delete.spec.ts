import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RecurringIncomeService } from './recurring-income.service';

const USER_ID = 'user-1';

function buildHarness() {
  const rule: any = {
    id: 'rule-1',
    userId: USER_ID,
    title: 'Salário',
    amount: new Prisma.Decimal(5000),
    frequency: 'MONTHLY',
    dayOfMonth: 5,
    firstOccurrence: '2026-09',
    counterpartyName: 'Empresa',
    isActive: true,
    deletedAt: null,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: new Date('2026-09-01T12:00:00Z'),
  };
  const rows: any[] = [
    {
      id: 'open',
      userId: USER_ID,
      recurringIncomeRuleId: rule.id,
      recurringMonth: '2026-09',
      isPaid: false,
      paymentTransactionId: null,
    },
    {
      id: 'paid',
      userId: USER_ID,
      recurringIncomeRuleId: rule.id,
      recurringMonth: '2026-08',
      isPaid: true,
      paymentTransactionId: 'tx-paid',
    },
  ];
  const writes = { deletedReceivables: [] as string[], transactions: 1 };
  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    recurringIncomeRule: {
      create: vi.fn(async ({ data }: any) => ({
        ...rule,
        ...data,
        id: 'rule-2',
        deletedAt: null,
        amount: new Prisma.Decimal(data.amount),
      })),
      findMany: vi.fn(async () => (rule.deletedAt ? [] : [rule])),
      findUnique: vi.fn(async ({ where }: any) =>
        where.userId === USER_ID && where.id === rule.id && !rule.deletedAt
          ? rule
          : null,
      ),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(rule, data);
        return rule;
      }),
    },
    receivable: {
      create: vi.fn(async ({ data }: any) => data),
      deleteMany: vi.fn(async ({ where }: any) => {
        const removed = rows.filter(
          (row) =>
            row.userId === where.userId &&
            row.recurringIncomeRuleId === where.recurringIncomeRuleId &&
            row.isPaid === where.isPaid &&
            row.paymentTransactionId === where.paymentTransactionId,
        );
        removed.forEach((row) => writes.deletedReceivables.push(row.id));
        rows.splice(
          0,
          rows.length,
          ...rows.filter((row) => !removed.includes(row)),
        );
        return { count: removed.length };
      }),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };

  return {
    rule,
    rows,
    writes,
    prisma,
    service: new RecurringIncomeService(prisma),
  };
}

describe('recurring income delete lifecycle', () => {
  it('tombstones the rule and removes only open occurrences', async () => {
    const harness = buildHarness();

    await harness.service.remove('rule-1', USER_ID);

    expect(harness.rule.isActive).toBe(false);
    expect(harness.rule.deletedAt).toBeInstanceOf(Date);
    expect(harness.writes.deletedReceivables).toEqual(['open']);
    expect(harness.rows.map((row) => row.id)).toEqual(['paid']);
    expect(harness.writes.transactions).toBe(1);
  });

  it('does not allow update/delete through another user', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.remove('rule-1', 'other-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allow a tombstoned rule to be found again', async () => {
    const harness = buildHarness();
    harness.rule.deletedAt = new Date();

    await expect(
      harness.service.findOne('rule-1', USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides tombstones from list and materialization', async () => {
    const harness = buildHarness();
    await harness.service.remove('rule-1', USER_ID);

    expect(await harness.service.findAll(USER_ID)).toEqual([]);
    expect(harness.prisma.recurringIncomeRule.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isActive: true, deletedAt: null },
    });
    expect(harness.prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('allows a new rule with the same business data after deletion', async () => {
    const harness = buildHarness();

    await harness.service.remove('rule-1', USER_ID);
    const recreated = await harness.service.create(USER_ID, {
      title: 'Salário',
      amount: 5000,
      dayOfMonth: 5,
      firstOccurrence: '2026-09',
    });

    expect(recreated.id).toBe('rule-2');
    expect(harness.prisma.recurringIncomeRule.create).toHaveBeenCalled();
  });
});
