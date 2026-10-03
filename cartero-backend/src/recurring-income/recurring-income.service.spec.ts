import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
  const users = new Map([
    [USER_ID, { id: USER_ID, timeZone: 'America/Sao_Paulo' }],
  ]);
  const rules = new Map<string, any>();
  const receivables = new Map<string, any>();
  const exclusions = new Map<string, any>();
  const lockTails = new Map<string, Promise<void>>();
  const lockKeys: string[] = [];
  let ruleSequence = 1;

  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(
        async ({ where }: any) =>
          users.get(where.id) ?? { timeZone: 'America/Sao_Paulo' },
      ),
      findMany: vi.fn(async ({ where, take }: any) =>
        [...users.values()]
          .filter(
            (user) =>
              (!where.id?.gt || user.id > where.id.gt) &&
              [...rules.values()].some(
                (item) =>
                  item.userId === user.id && item.isActive && !item.deletedAt,
              ),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take),
      ),
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
            (!where.isActive || item.isActive === where.isActive) &&
            (where.deletedAt !== null || !item.deletedAt),
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
          exclusions.set(
            `${item.recurringIncomeRuleId}:${item.recurringMonth}`,
            item,
          );
        }
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }: any) => ({
        count: exclusions.delete(
          `${where.recurringIncomeRuleId}:${where.recurringMonth}`,
        )
          ? 1
          : 0,
      })),
    },
    receivable: {
      findUnique: vi.fn(
        async ({ where }: any) =>
          [...receivables.values()].find(
            (item) => item.id === where.id && item.userId === where.userId,
          ) ?? null,
      ),
      delete: vi.fn(async ({ where }: any) => {
        const entry = [...receivables.entries()].find(
          ([, item]) => item.id === where.id && item.userId === where.userId,
        );
        if (!entry) throw new Error('missing receivable');
        receivables.delete(entry[0]);
        return entry[1];
      }),
      createMany: vi.fn(async ({ data }: any) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        let count = 0;
        for (const item of data) {
          const key = `${item.recurringIncomeRuleId}:${item.recurringMonth}`;
          if (!receivables.has(key)) {
            const created = {
              id: `receivable-${receivables.size + 1}`,
              ...item,
            };
            receivables.set(key, created);
            count += 1;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (callback: any) => {
      const receivableSnapshot = new Map(receivables);
      const exclusionSnapshot = new Map(exclusions);
      const releases: Array<() => void> = [];
      const tx = Object.create(prisma);
      tx.$executeRaw = vi.fn(
        async (_strings: TemplateStringsArray, key: string) => {
          lockKeys.push(key);
          const previous = lockTails.get(key) ?? Promise.resolve();
          let unlock!: () => void;
          const current = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          const tail = previous.then(() => current);
          lockTails.set(key, tail);
          await previous;
          releases.push(() => {
            unlock();
            if (lockTails.get(key) === tail) lockTails.delete(key);
          });
        },
      );

      try {
        return await callback(tx);
      } catch (error) {
        receivables.clear();
        receivableSnapshot.forEach((value, key) => receivables.set(key, value));
        exclusions.clear();
        exclusionSnapshot.forEach((value, key) => exclusions.set(key, value));
        throw error;
      } finally {
        for (const release of releases.reverse()) release();
      }
    }),
  };

  return {
    prisma,
    users,
    rules,
    receivables,
    exclusions,
    lockKeys,
    service: new RecurringIncomeService(prisma),
  };
}

describe('RecurringIncomeService', () => {
  it('keeps recurring rule list and detail reads pure', async () => {
    const harness = buildHarness();
    const source = rule();
    harness.rules.set(source.id, source);
    const ensure = vi.spyOn(harness.service, 'ensureForUser');

    await harness.service.findAll(USER_ID);
    await harness.service.findOne(source.id, USER_ID);

    expect(ensure).not.toHaveBeenCalled();
    expect(harness.prisma.receivable.createMany).not.toHaveBeenCalled();
    expect(harness.lockKeys).toHaveLength(0);
  });

  it('reconciles one requested period idempotently and respects its tombstone', async () => {
    const harness = buildHarness();
    const source = rule({ firstOccurrence: '2026-01' });
    harness.rules.set(source.id, source);
    const now = new Date('2026-10-15T12:00:00Z');

    await harness.service.reconcileForUserPeriod(USER_ID, 10, 2026, now);
    await harness.service.reconcileForUserPeriod(USER_ID, 10, 2026, now);
    expect([...harness.receivables.values()]).toHaveLength(1);
    expect([...harness.receivables.values()][0].recurringMonth).toBe('2026-10');

    harness.receivables.clear();
    harness.exclusions.set(`${source.id}:2026-10`, {
      userId: USER_ID,
      recurringIncomeRuleId: source.id,
      recurringMonth: '2026-10',
    });
    await harness.service.reconcileForUserPeriod(USER_ID, 10, 2026, now);
    expect(harness.receivables.size).toBe(0);
    expect(harness.lockKeys).toEqual([
      `recurring-income-occurrences:${USER_ID}:${source.id}`,
      `recurring-income-occurrences:${USER_ID}:${source.id}`,
      `recurring-income-occurrences:${USER_ID}:${source.id}`,
    ]);
  });

  it('validates period values and limits future reconciliation to twelve months', async () => {
    const harness = buildHarness();
    const now = new Date('2026-10-01T02:00:00Z');
    await expect(
      harness.service.reconcileForUserPeriod(USER_ID, 13, 2026, now),
    ).rejects.toBeInstanceOf(BadRequestException);
    // In São Paulo this instant is still September; the limit follows account time.
    await expect(
      harness.service.reconcileForUserPeriod(USER_ID, 9, 2027, now),
    ).resolves.toEqual({ month: '2027-09', created: 0 });
    await expect(
      harness.service.reconcileForUserPeriod(USER_ID, 10, 2027, now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes one pending occurrence atomically and materialization keeps the tombstone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    try {
      const harness = buildHarness();
      const source = rule({ firstOccurrence: '2026-09' });
      harness.rules.set(source.id, source);
      const row = (month: string) => ({
        id: `receivable-${month}`,
        userId: USER_ID,
        title: source.title,
        amount: source.amount,
        recurringIncomeRuleId: source.id,
        recurringMonth: month,
        isPaid: false,
        transactionId: null,
        paymentTransactionId: null,
        dueDate: new Date(`${month}-05T00:00:00Z`),
      });
      for (const month of ['2026-09', '2026-10', '2026-11']) {
        harness.receivables.set(`${source.id}:${month}`, row(month));
      }

      await harness.service.deletePendingOccurrence(
        USER_ID,
        'receivable-2026-10',
      );
      expect(harness.exclusions.has(`${source.id}:2026-10`)).toBe(true);
      expect(
        [...harness.receivables.values()].map((item) => item.recurringMonth),
      ).toEqual(['2026-09', '2026-11']);
      expect(harness.rules.get(source.id)).toEqual(source);
      await harness.service.ensureForUser(
        USER_ID,
        new Date('2026-11-15T12:00:00Z'),
      );
      expect(
        [...harness.receivables.values()].map((item) => item.recurringMonth),
      ).not.toContain('2026-10');
      expect(harness.lockKeys).toContain(
        `recurring-income-occurrences:${USER_ID}:${source.id}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks paid and cross-tenant occurrence deletes without a tombstone', async () => {
    const harness = buildHarness();
    const source = rule();
    harness.rules.set(source.id, source);
    const paid = {
      id: 'paid',
      userId: USER_ID,
      recurringIncomeRuleId: source.id,
      recurringMonth: '2026-10',
      isPaid: true,
      transactionId: null,
      paymentTransactionId: 'payment-1',
    };
    const foreign = {
      id: 'foreign',
      userId: 'user-2',
      recurringIncomeRuleId: source.id,
      recurringMonth: '2026-10',
      isPaid: false,
      transactionId: null,
      paymentTransactionId: null,
    };
    harness.receivables.set('paid', paid);
    harness.receivables.set('foreign', foreign);
    await expect(
      harness.service.deletePendingOccurrence(USER_ID, 'paid'),
    ).rejects.toMatchObject({
      response: { code: 'RECURRING_INCOME_RECEIVABLE_DELETE_BLOCKED' },
    });
    await expect(
      harness.service.deletePendingOccurrence(USER_ID, 'foreign'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.exclusions.size).toBe(0);
    expect(harness.receivables.has('paid')).toBe(true);
    expect(harness.receivables.has('foreign')).toBe(true);
  });

  it('rolls back the tombstone if deleting the occurrence fails', async () => {
    const harness = buildHarness();
    const source = rule();
    harness.rules.set(source.id, source);
    const row = {
      id: 'one',
      userId: USER_ID,
      recurringIncomeRuleId: source.id,
      recurringMonth: '2026-10',
      isPaid: false,
      transactionId: null,
      paymentTransactionId: null,
    };
    harness.receivables.set('one', row);
    harness.prisma.receivable.delete.mockRejectedValueOnce(
      new Error('delete failed'),
    );
    await expect(
      harness.service.deletePendingOccurrence(USER_ID, 'one'),
    ).rejects.toThrow('delete failed');
    expect(harness.exclusions.size).toBe(0);
    expect(harness.receivables.get('one')).toBe(row);
  });

  it('leaves the row intact if marker creation fails and returns a clean not-found on double delete', async () => {
    const harness = buildHarness();
    const source = rule();
    harness.rules.set(source.id, source);
    const row = {
      id: 'one',
      userId: USER_ID,
      recurringIncomeRuleId: source.id,
      recurringMonth: '2026-10',
      isPaid: false,
      transactionId: null,
      paymentTransactionId: null,
    };
    harness.receivables.set('one', row);
    harness.prisma.recurringIncomeOccurrenceExclusion.createMany.mockRejectedValueOnce(
      new Error('marker failed'),
    );
    await expect(
      harness.service.deletePendingOccurrence(USER_ID, 'one'),
    ).rejects.toThrow('marker failed');
    expect(harness.receivables.get('one')).toBe(row);
    expect(harness.exclusions.size).toBe(0);

    await harness.service.deletePendingOccurrence(USER_ID, 'one');
    await expect(
      harness.service.deletePendingOccurrence(USER_ID, 'one'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.exclusions.size).toBe(1);
    expect(harness.receivables.has('one')).toBe(false);
  });

  it('serializes a concurrent materialization with deletion and restore allows later reconciliation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    try {
      const harness = buildHarness();
      const source = rule({ firstOccurrence: '2026-10' });
      harness.rules.set(source.id, source);
      const row = {
        id: 'october',
        userId: USER_ID,
        title: source.title,
        amount: source.amount,
        recurringIncomeRuleId: source.id,
        recurringMonth: '2026-10',
        isPaid: false,
        transactionId: null,
        paymentTransactionId: null,
      };
      harness.receivables.set(`${source.id}:2026-10`, row);

      await Promise.all([
        harness.service.deletePendingOccurrence(USER_ID, row.id),
        harness.service.ensureForUser(
          USER_ID,
          new Date('2026-10-15T12:00:00Z'),
        ),
      ]);
      expect(harness.exclusions.has(`${source.id}:2026-10`)).toBe(true);
      expect(
        [...harness.receivables.values()].some(
          (item) => item.recurringMonth === '2026-10',
        ),
      ).toBe(false);

      await harness.service.restoreOccurrence(USER_ID, source.id, '2026-10');
      await harness.service.ensureForUser(
        USER_ID,
        new Date('2026-10-15T12:00:00Z'),
      );
      expect(
        [...harness.receivables.values()].some(
          (item) => item.recurringMonth === '2026-10',
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('keeps preview occurrence count and materialized rows in parity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    try {
      const harness = buildHarness();
      const input = {
        title: 'Salário',
        amount: 5000,
        dayOfMonth: 1,
        firstOccurrence: '2026-03',
        counterpartyName: 'Empresa',
      };
      const preview = await harness.service.preview(USER_ID, input);
      await harness.service.create(USER_ID, input);
      const created = [...harness.receivables.values()];

      expect(created).toHaveLength(preview.occurrenceCount);
      expect(created.every((item) => item.isPaid === false)).toBe(true);
      expect(
        created.map((item) => item.dueDate.toISOString().slice(0, 10)),
      ).toEqual([
        '2026-03-01',
        '2026-04-01',
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
        '2026-09-01',
        '2026-10-01',
        '2026-11-01',
      ]);
      expect(preview).toMatchObject({
        occurrenceCount: 9,
        overdueCount: 8,
        currentMonthCount: 1,
        nextOccurrenceDate: '2026-11-01',
      });
    } finally {
      vi.useRealTimers();
    }
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

  it('repeated ensures skip existing occurrences without overwriting snapshots', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-23T12:00:00Z'),
    );
    const existing = harness.receivables.get('rule-1:2026-09');
    Object.assign(existing, {
      amount: new Prisma.Decimal(7777),
      dueDate: new Date('2026-09-02T12:00:00Z'),
      title: 'Editado manualmente',
      debtorName: 'Contraparte editada',
      isPaid: true,
      paymentTransactionId: 'payment-1',
    });

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-23T12:00:00Z'),
    );

    expect(harness.receivables.size).toBe(2);
    expect(harness.receivables.get('rule-1:2026-09')).toMatchObject({
      amount: new Prisma.Decimal(7777),
      dueDate: new Date('2026-09-02T12:00:00Z'),
      title: 'Editado manualmente',
      debtorName: 'Contraparte editada',
      isPaid: true,
      paymentTransactionId: 'payment-1',
    });
  });

  it('recreates a deleted occurrence on the next ensureForUser read path', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());
    const now = new Date('2026-09-23T12:00:00Z');

    await harness.service.ensureForUser(USER_ID, now);
    const key = 'rule-1:2026-09';
    expect(harness.receivables.has(key)).toBe(true);

    // Simulate deleting only the canonical occurrence. The active source and
    // its month remain, so the unique key no longer prevents materialization.
    harness.receivables.delete(key);
    await harness.service.ensureForUser(USER_ID, now);

    expect(harness.receivables.has(key)).toBe(true);
    expect(harness.receivables.has('rule-1:2026-10')).toBe(true);
    expect(harness.rules.get('rule-1').isActive).toBe(true);
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
    expect(harness.rules.get('rule-1').firstOccurrence).toBe('2026-09');
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

  it('skips only tombstoned months with one tenant-scoped batch exclusion query', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-03', dayOfMonth: 1 }),
    );
    harness.exclusions.set('rule-1:2026-06', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-06',
    });

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-30T12:00:00Z'),
    );

    expect([...harness.receivables.keys()]).toEqual([
      'rule-1:2026-03',
      'rule-1:2026-04',
      'rule-1:2026-05',
      'rule-1:2026-07',
      'rule-1:2026-08',
      'rule-1:2026-09',
      'rule-1:2026-10',
    ]);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.findMany,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.findMany,
    ).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        recurringIncomeRuleId: 'rule-1',
        recurringMonth: {
          in: [
            '2026-03',
            '2026-04',
            '2026-05',
            '2026-06',
            '2026-07',
            '2026-08',
            '2026-09',
            '2026-10',
          ],
        },
      },
      select: { recurringMonth: true },
    });
  });

  it('does not recreate a tombstoned month through ensureForUser', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );
    harness.exclusions.set('rule-1:2026-10', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-10',
    });

    await harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-30T12:00:00Z'),
    );

    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
  });

  it('ensureAll respects the same exclusion filter', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );
    harness.exclusions.set('rule-1:2026-10', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-10',
    });

    await harness.service.ensureAll(new Date('2026-09-30T12:00:00Z'));

    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
  });

  it('keeps exclusions through source edit, deactivation, and reactivation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    try {
      const harness = buildHarness();
      harness.rules.set(
        'rule-1',
        rule({ firstOccurrence: '2026-03', dayOfMonth: 1 }),
      );
      harness.exclusions.set('rule-1:2026-10', {
        userId: USER_ID,
        recurringIncomeRuleId: 'rule-1',
        recurringMonth: '2026-10',
      });

      await harness.service.update('rule-1', USER_ID, {
        title: 'Salário atualizado',
        amount: 6000,
        dayOfMonth: 5,
        isActive: false,
      });
      await harness.service.update('rule-1', USER_ID, { isActive: true });

      expect(harness.exclusions.has('rule-1:2026-10')).toBe(true);
      expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
      expect(harness.rules.get('rule-1').title).toBe('Salário atualizado');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an existing receivable when a later tombstone is present', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );
    const now = new Date('2026-09-30T12:00:00Z');
    await harness.service.ensureForUser(USER_ID, now);
    const existing = harness.receivables.get('rule-1:2026-10');
    harness.exclusions.set('rule-1:2026-10', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-10',
    });

    await harness.service.ensureForUser(USER_ID, now);

    expect(harness.receivables.get('rule-1:2026-10')).toBe(existing);
    expect(harness.prisma.receivable.deleteMany).not.toHaveBeenCalled();
  });

  it('does not let one user’s exclusion suppress another user’s rule', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-user-b',
      rule({
        id: 'rule-user-b',
        userId: 'user-b',
        firstOccurrence: '2026-10',
        dayOfMonth: 1,
      }),
    );
    harness.exclusions.set('rule-1:2026-10', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-10',
    });

    await harness.service.ensureForUser(
      'user-b',
      new Date('2026-09-30T12:00:00Z'),
    );

    expect(harness.receivables.has('rule-user-b:2026-10')).toBe(true);
    expect(
      harness.prisma.recurringIncomeOccurrenceExclusion.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-b',
          recurringIncomeRuleId: 'rule-user-b',
        }),
      }),
    );
  });

  it('serializes suppress and materialize for the same rule', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    harness.prisma.recurringIncomeOccurrenceExclusion.createMany.mockImplementationOnce(
      async ({ data }: any) => {
        signalWriteStarted();
        await writeGate;
        for (const item of data) {
          harness.exclusions.set(
            `${item.recurringIncomeRuleId}:${item.recurringMonth}`,
            item,
          );
        }
        return { count: data.length };
      },
    );

    const suppression = harness.service.suppressOccurrence(
      USER_ID,
      'rule-1',
      '2026-10',
    );
    await writeStarted;
    const materialization = harness.service.ensureForUser(
      USER_ID,
      new Date('2026-09-30T12:00:00Z'),
    );
    releaseWrite();
    await suppression;
    await materialization;

    expect(harness.exclusions.has('rule-1:2026-10')).toBe(true);
    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
    expect(harness.lockKeys).toEqual([
      'recurring-income-occurrences:user-1:rule-1',
      'recurring-income-occurrences:user-1:rule-1',
    ]);
  });

  it('enforces ownership on update', async () => {
    const harness = buildHarness();
    harness.rules.set('rule-1', rule());

    await expect(
      harness.service.update('rule-1', 'other-user', { amount: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('recurring income global reconciliation scan', () => {
  const now = new Date('2026-09-30T12:00:00Z');

  function addUser(harness: ReturnType<typeof buildHarness>, id: string) {
    harness.users.set(id, { id, timeZone: 'America/Sao_Paulo' });
    harness.rules.set(
      `rule-${id}`,
      rule({
        id: `rule-${id}`,
        userId: id,
        firstOccurrence: '2026-10',
        dayOfMonth: 1,
      }),
    );
  }

  it('keyset-paginates active users without duplicates', async () => {
    const harness = buildHarness();
    for (let index = 1; index <= 5; index++) addUser(harness, `user-${index}`);

    const summary = await harness.service.ensureAll(now, 2);

    expect(summary).toMatchObject({
      usersScanned: 5,
      usersSucceeded: 5,
      usersFailed: 0,
      batchesProcessed: 3,
      occurrencesCreated: 5,
    });
    expect(harness.prisma.user.findMany).toHaveBeenCalledTimes(3);
    expect(
      harness.prisma.recurringIncomeRule.findMany.mock.calls.map(
        ([args]: any[]) => args.where.userId,
      ),
    ).toEqual(['user-1', 'user-2', 'user-3', 'user-4', 'user-5']);
    expect(harness.receivables.size).toBe(5);
  });

  it('records one user failure and continues later users without sensitive logs', async () => {
    const harness = buildHarness();
    for (let index = 1; index <= 4; index++) addUser(harness, `user-${index}`);
    const original =
      harness.prisma.recurringIncomeRule.findMany.getMockImplementation();
    harness.prisma.recurringIncomeRule.findMany.mockImplementation(
      async (args: any) => {
        if (args.where.userId === 'user-2')
          throw new Error('private amount 5000');
        return original(args);
      },
    );
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const summary = await harness.service.ensureAll(now, 2);
      expect(summary).toMatchObject({
        usersScanned: 4,
        usersSucceeded: 3,
        usersFailed: 1,
        batchesProcessed: 2,
      });
      expect(harness.receivables.has('rule-user-3:2026-10')).toBe(true);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('"userId":"user-2"'),
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'private amount',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('recovers after a page failure and does not duplicate committed rows', async () => {
    const harness = buildHarness();
    for (let index = 1; index <= 3; index++) addUser(harness, `user-${index}`);
    const original = harness.prisma.user.findMany.getMockImplementation();
    let queries = 0;
    harness.prisma.user.findMany.mockImplementation(async (args: any) => {
      queries += 1;
      if (queries === 2) throw new Error('page failed');
      return original(args);
    });

    await expect(harness.service.ensureAll(now, 1)).rejects.toThrow(
      'page failed',
    );
    expect(harness.receivables.size).toBe(1);

    const retried = await harness.service.ensureAll(now, 1);
    expect(retried.usersSucceeded).toBe(3);
    expect(retried.occurrencesCreated).toBe(2);
    expect(harness.receivables.size).toBe(3);
  });

  it('keeps an R6B3 deleted occurrence absent on scheduler reruns', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );

    await harness.service.ensureAll(now);
    const occurrence = harness.receivables.get('rule-1:2026-10');
    await harness.service.deletePendingOccurrence(USER_ID, occurrence.id);
    await harness.service.ensureAll(now);

    expect(harness.exclusions.has('rule-1:2026-10')).toBe(true);
    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
  });

  it('selects active sources only and respects tombstones after reactivation', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', isActive: false }),
    );
    addUser(harness, 'user-deleted');
    harness.rules.get('rule-user-deleted').deletedAt = new Date();
    harness.exclusions.set('rule-1:2026-10', {
      userId: USER_ID,
      recurringIncomeRuleId: 'rule-1',
      recurringMonth: '2026-10',
    });

    const inactive = await harness.service.ensureAll(now);
    expect(inactive.usersScanned).toBe(0);

    harness.rules.get('rule-1').isActive = true;
    const reactivated = await harness.service.ensureAll(now);
    expect(reactivated.usersScanned).toBe(1);
    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
    expect(harness.receivables.has('rule-user-deleted:2026-10')).toBe(false);
  });

  it('uses each account timezone for the 30-day civil horizon', async () => {
    const harness = buildHarness();
    harness.users.get(USER_ID)!.timeZone = 'America/Fortaleza';
    harness.users.set('user-east', {
      id: 'user-east',
      timeZone: 'Pacific/Kiritimati',
    });
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );
    harness.rules.set(
      'rule-east',
      rule({
        id: 'rule-east',
        userId: 'user-east',
        firstOccurrence: '2026-10',
        dayOfMonth: 1,
      }),
    );

    await harness.service.ensureAll(new Date('2026-09-01T02:30:00Z'), 1);

    expect(harness.receivables.has('rule-1:2026-10')).toBe(false);
    expect(harness.receivables.has('rule-east:2026-10')).toBe(true);
  });

  it('converges with an explicit reconcile through the existing per-rule lock', async () => {
    const harness = buildHarness();
    harness.rules.set(
      'rule-1',
      rule({ firstOccurrence: '2026-10', dayOfMonth: 1 }),
    );

    await Promise.all([
      harness.service.ensureAll(now),
      harness.service.reconcileForUserPeriod(USER_ID, 10, 2026, now),
    ]);

    expect(harness.receivables.has('rule-1:2026-10')).toBe(true);
    expect(harness.receivables.size).toBe(1);
    expect(harness.lockKeys).toEqual([
      'recurring-income-occurrences:user-1:rule-1',
      'recurring-income-occurrences:user-1:rule-1',
    ]);
  });
});
