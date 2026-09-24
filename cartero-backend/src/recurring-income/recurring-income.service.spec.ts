import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecurringIncomeService } from './recurring-income.service';

const USER_ID = 'user-1';

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    userId: USER_ID,
    title: 'Salário',
    amount: new Prisma.Decimal(5000),
    frequency: 'MONTHLY',
    dayOfMonth: 5,
    firstOccurrence: '2026-09',
    counterpartyName: 'Empresa',
    isActive: true,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  };
}

function buildHarness() {
  const rules = new Map<string, any>();
  const receivables = new Map<string, any>();
  let ruleSequence = 1;

  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
      findMany: vi.fn(async () => [
        { id: USER_ID, timeZone: 'America/Sao_Paulo' },
      ]),
    },
    recurringIncomeRule: {
      create: vi.fn(async ({ data }: any) => {
        const created = rule({ id: `rule-${ruleSequence++}`, ...data });
        rules.set(created.id, created);
        return created;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...rules.values()].filter(
          (item) =>
            item.userId === where.userId &&
            (!where.isActive || item.isActive === where.isActive),
        ),
      ),
      findUnique: vi.fn(async ({ where }: any) => {
        const item = rules.get(where.id);
        return item?.userId === where.userId ? item : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const item = rules.get(where.id);
        Object.assign(
          item,
          Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        );
        return item;
      }),
    },
    receivable: {
      create: vi.fn(async ({ data }: any) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const key = `${data.recurringIncomeRuleId}:${data.recurringMonth}`;
        if (receivables.has(key)) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const created = { id: `receivable-${receivables.size + 1}`, ...data };
        receivables.set(key, created);
        return created;
      }),
    },
  };

  return {
    prisma,
    rules,
    receivables,
    service: new RecurringIncomeService(prisma),
  };
}

describe('RecurringIncomeService', () => {
  it('materializes an explicit competence as an INCOME receivable', async () => {
    const harness = buildHarness();

    await harness.service.create(USER_ID, {
      title: 'Salário',
      amount: 5000,
      dayOfMonth: 31,
      firstOccurrence: '2026-09',
      counterpartyName: 'Empresa',
    });

    const created = [...harness.receivables.values()][0];
    expect(created.incomeClassification).toBe('INCOME');
    expect(created.recurringIncomeRuleId).toBe('rule-1');
    expect(created.recurringMonth).toBe('2026-09');
    expect(created.dueDate.toISOString()).toContain('2026-09-30');
    expect(created.personId).toBeUndefined();
    expect(created.paymentTransactionId).toBeUndefined();
  });

  it('does not materialize beyond the inclusive +30 horizon', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 24 }),
    );

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-23T12:00:00Z'),
    );
    expect(harness.receivables.size).toBe(0);
  });

  it('concurrent ensures converge to one receivable per competence', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());

    await Promise.all([
      harness.service.ensureForUser(USER_ID, new Date('2026-09-23T12:00:00Z')),
      harness.service.ensureForUser(USER_ID, new Date('2026-09-23T12:00:00Z')),
    ]);

    expect(harness.receivables.size).toBe(2);
    expect([...harness.receivables.keys()]).toEqual([
      'rule-1:2026-09',
      'rule-1:2026-10',
    ]);
  });

  it('edits are snapshots: existing occurrences keep the old amount', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-23T12:00:00Z'),
    );
    await harness.service.update('rule-1', USER_ID, { amount: 5500 });
    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-10-23T12:00:00Z'),
    );

    expect(harness.receivables.get('rule-1:2026-09').amount.toString()).toBe(
      '5000',
    );
    expect(harness.receivables.get('rule-1:2026-10').amount.toString()).toBe(
      '5000',
    );
    expect(harness.receivables.get('rule-1:2026-11').amount.toString()).toBe(
      '5500',
    );
  });

  it('deactivate prevents future materialization and keeps existing rows', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());
    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-23T12:00:00Z'),
    );
    await harness.service.deactivate('rule-1', USER_ID);
    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-10-23T12:00:00Z'),
    );

    expect(harness.receivables.size).toBe(2);
    expect(harness.rules.get('rule-1').isActive).toBe(false);
  });

  it('enforces ownership on update', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());

    await expect(
      harness.service.update('rule-1', 'other-user', { amount: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
