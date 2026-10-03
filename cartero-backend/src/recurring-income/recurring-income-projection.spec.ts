import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RecurringIncomeService } from './recurring-income.service';

describe('read-only recurring income projection', () => {
  it('projects only missing non-tombstoned rules and preserves civil month dates', async () => {
    const ruleFindMany = vi.fn(async () => [
      {
        id: 'snapshot',
        amount: new Prisma.Decimal(500),
        dayOfMonth: 31,
        title: 'Salário',
        counterpartyName: null,
      },
      {
        id: 'excluded',
        amount: new Prisma.Decimal(300),
        dayOfMonth: 5,
        title: 'Extra',
        counterpartyName: null,
      },
      {
        id: 'settled',
        amount: new Prisma.Decimal(200),
        dayOfMonth: 15,
        title: 'Salário pago',
        counterpartyName: null,
      },
      {
        id: 'missing',
        amount: new Prisma.Decimal(700),
        dayOfMonth: 31,
        title: 'Salário',
        counterpartyName: null,
      },
    ]);
    const receivableFindMany = vi.fn(async () => [
      { recurringIncomeRuleId: 'snapshot' },
      { recurringIncomeRuleId: 'settled' },
    ]);
    const exclusionFindMany = vi.fn(async () => [
      { recurringIncomeRuleId: 'excluded' },
    ]);
    const createMany = vi.fn();
    const prisma: any = {
      recurringIncomeRule: { findMany: ruleFindMany },
      receivable: { findMany: receivableFindMany, createMany },
      recurringIncomeOccurrenceExclusion: { findMany: exclusionFindMany },
    };
    const service = new RecurringIncomeService(prisma);

    const result = await service.projectMissingOccurrencesForMonth(
      'user-a',
      '2026-09',
    );

    expect(result).toEqual([
      {
        recurringIncomeRuleId: 'missing',
        amount: new Prisma.Decimal(700),
        dueDate: new Date('2026-09-30T12:00:00.000Z'),
        title: 'Salário',
        counterpartyName: null,
      },
    ]);
    expect(ruleFindMany).toHaveBeenCalledTimes(1);
    expect(receivableFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-a',
          recurringMonth: '2026-09',
        }),
      }),
    );
    expect(exclusionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-a',
          recurringMonth: '2026-09',
        }),
      }),
    );
    expect(createMany).not.toHaveBeenCalled();
  });
});
