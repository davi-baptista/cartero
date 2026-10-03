import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RecurringIncomeService } from './recurring-income.service';

function buildHarness() {
  const rules = new Map<string, any>([
    [
      'rule-a',
      {
        id: 'rule-a',
        userId: 'user-a',
        firstOccurrence: '2026-01',
        title: 'Salário',
        amount: new Prisma.Decimal(5000),
        dayOfMonth: 1,
        isActive: true,
        deletedAt: null,
      },
    ],
    [
      'rule-b',
      {
        id: 'rule-b',
        userId: 'user-b',
        firstOccurrence: '2026-01',
        title: 'Outra fonte',
        amount: new Prisma.Decimal(2000),
        dayOfMonth: 10,
        isActive: true,
        deletedAt: null,
      },
    ],
  ]);
  const exclusions = new Map<string, any>();
  const key = (ruleId: string, month: string) => `${ruleId}:${month}`;
  const prisma: any = {
    recurringIncomeRule: {
      findUnique: vi.fn(async ({ where }: any) => {
        const rule = rules.get(where.id);
        return rule?.userId === where.userId ? rule : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const rule = rules.get(where.id);
        Object.assign(rule, data);
        return rule;
      }),
    },
    recurringIncomeOccurrenceExclusion: {
      findMany: vi.fn(async ({ where }: any) =>
        [...exclusions.values()].filter(
          (item) =>
            item.userId === where.userId &&
            item.recurringIncomeRuleId === where.recurringIncomeRuleId &&
            where.recurringMonth.in.includes(item.recurringMonth),
        ),
      ),
      createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) {
          const itemKey = key(item.recurringIncomeRuleId, item.recurringMonth);
          if (!exclusions.has(itemKey)) exclusions.set(itemKey, item);
        }
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }: any) => ({
        count: exclusions.delete(
          key(where.recurringIncomeRuleId, where.recurringMonth),
        )
          ? 1
          : 0,
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    receivable: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };

  return {
    exclusions,
    prisma,
    rules,
    service: new RecurringIncomeService(prisma),
  };
}

describe('recurring income occurrence exclusions', () => {
  it('suppresses idempotently without deleting or materializing a receivable', async () => {
    const harness = buildHarness();

    await harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10');
    await harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10');

    expect(harness.exclusions.size).toBe(1);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-a',
          recurringIncomeRuleId: 'rule-a',
          recurringMonth: '2026-10',
        },
      ],
      skipDuplicates: true,
    });
    expect(harness.prisma.receivable.createMany).not.toHaveBeenCalled();
    expect(harness.prisma.receivable.deleteMany).not.toHaveBeenCalled();
  });

  it('converges concurrent suppressions to one marker', async () => {
    const harness = buildHarness();

    await Promise.all([
      harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10'),
      harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10'),
    ]);

    expect(harness.exclusions.size).toBe(1);
  });

  it('blocks suppress and restore when the rule belongs to another tenant', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.suppressOccurrence('user-a', 'rule-b', '2026-10'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      harness.service.restoreOccurrence('user-a', 'rule-b', '2026-10'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.createMany,
    ).not.toHaveBeenCalled();
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('validates YYYY-MM and rejects months before the source starts', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.suppressOccurrence('user-a', 'rule-a', '2026-13'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      harness.service.suppressOccurrence('user-a', 'rule-a', '2025-12'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.createMany,
    ).not.toHaveBeenCalled();
  });

  it('restore is idempotent and only removes the marker', async () => {
    const harness = buildHarness();

    await harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10');
    await harness.service.restoreOccurrence('user-a', 'rule-a', '2026-10');
    await harness.service.restoreOccurrence('user-a', 'rule-a', '2026-10');

    expect(harness.exclusions.size).toBe(0);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.deleteMany,
    ).toHaveBeenCalledTimes(2);
    expect(harness.prisma.receivable.createMany).not.toHaveBeenCalled();
  });

  it('preserves the marker across source edits, deactivation, and reactivation', async () => {
    const harness = buildHarness();
    await harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10');

    await harness.service.update('rule-a', 'user-a', {
      title: 'Novo salário',
      amount: 6000,
      dayOfMonth: 5,
      isActive: false,
    });
    expect(harness.exclusions.has('rule-a:2026-10')).toBe(true);

    await harness.service.update('rule-a', 'user-a', {
      isActive: true,
    });
    expect(harness.exclusions.has('rule-a:2026-10')).toBe(true);
  });

  it('preserves the marker when the source is soft-deleted', async () => {
    const harness = buildHarness();
    await harness.service.suppressOccurrence('user-a', 'rule-a', '2026-10');

    await harness.service.remove('rule-a', 'user-a');

    expect(harness.exclusions.has('rule-a:2026-10')).toBe(true);
    expect(harness.rules.get('rule-a').deletedAt).toBeInstanceOf(Date);
  });
});
