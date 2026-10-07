import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RecurringExpenseService } from './recurring-expense.service';
import { recurringExpenseResumeMonth } from './recurring-expense.helper';

const USER = 'user-1';
const ZONE = 'America/Sao_Paulo';

function harness() {
  const rules = new Map<string, any>();
  const debts = new Map<string, any>();
  const exclusions = new Set<string>();
  const tx: any = {
    recurringExpenseRule: {
      create: vi.fn(async ({ data }: any) => {
        const rule = {
          id: 'rule-1',
          ...data,
          amount: new Prisma.Decimal(data.amount),
          isActive: true,
          activeSince: null,
          deletedAt: null,
        };
        rules.set(rule.id, rule);
        return rule;
      }),
      findUnique: vi.fn(async ({ where }: any) => rules.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) =>
        [...rules.values()].filter(
          (rule) =>
            rule.userId === where.userId &&
            (!where.isActive || rule.isActive) &&
            !rule.deletedAt,
        ),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const rule = rules.get(where.id);
        Object.assign(
          rule,
          Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        );
        return { ...rule };
      }),
    },
    recurringExpenseOccurrenceExclusion: {
      findMany: vi.fn(async ({ where }: any) =>
        [...exclusions]
          .map((key) => key.split(':'))
          .filter(
            ([id, month]) =>
              (
                where.recurringExpenseRuleId?.in ?? [
                  where.recurringExpenseRuleId,
                ]
              ).includes(id) &&
              (where.recurringMonth?.in ?? [where.recurringMonth]).includes(
                month,
              ),
          )
          .map(([recurringExpenseRuleId, recurringMonth]) => ({
            recurringExpenseRuleId,
            recurringMonth,
          })),
      ),
    },
    debt: {
      createMany: vi.fn(async ({ data }: any) => {
        let count = 0;
        for (const row of data) {
          const key = `${row.recurringExpenseRuleId}:${row.recurringMonth}`;
          if (!debts.has(key)) {
            debts.set(key, {
              ...row,
              isPaid: false,
              paymentTransactionId: null,
            });
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0;
        for (const [key, debt] of debts) {
          if (
            debt.recurringExpenseRuleId === where.recurringExpenseRuleId &&
            !debt.isPaid &&
            !debt.paymentTransactionId &&
            debt.dueDate > where.dueDate.gt
          ) {
            debts.delete(key);
            count++;
          }
        }
        return { count };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...debts.values()].filter(
          (debt) =>
            where.recurringExpenseRuleId.in.includes(
              debt.recurringExpenseRuleId,
            ) && debt.recurringMonth === where.recurringMonth,
        ),
      ),
    },
  };
  const prisma: any = {
    ...tx,
    user: { findUniqueOrThrow: vi.fn(async () => ({ timeZone: ZONE })) },
    $transaction: vi.fn(async (fn: (client: any) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const service = new RecurringExpenseService(prisma, {
    validatePerson: vi.fn(),
  } as any);
  return { service, rules, debts, exclusions, tx };
}

describe('manual recurring expense lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps month end and inserts a cycle only once', async () => {
    const h = harness();
    await h.service.create(USER, {
      title: 'Aluguel',
      amount: 1000,
      dayOfMonth: 31,
      firstOccurrence: '2026-10',
    });
    expect(
      [...h.debts.values()].map((debt) =>
        debt.dueDate.toISOString().slice(0, 10),
      ),
    ).toEqual(['2026-10-31']);
    await h.service.ensureForUser(USER);
    expect(h.debts.size).toBe(1);
    expect(await h.service.reconcileForUserPeriod(USER, 2, 2027)).toEqual({
      month: '2027-02',
      created: 1,
    });
    expect(
      h.debts.get('rule-1:2027-02').dueDate.toISOString().slice(0, 10),
    ).toBe('2027-02-28');
  });

  it('pauses future open debt, keeps paid debt, and resumes without catch-up', async () => {
    const h = harness();
    await h.service.create(USER, {
      title: 'Aluguel',
      amount: 1000,
      dayOfMonth: 10,
      firstOccurrence: '2026-10',
    });
    await h.service.reconcileForUserPeriod(USER, 11, 2026);
    h.debts.get('rule-1:2026-10').isPaid = true;
    await h.service.update('rule-1', USER, { isActive: false });
    expect([...h.debts.keys()]).toEqual(['rule-1:2026-10']);
    vi.setSystemTime(new Date('2026-12-12T12:00:00Z'));
    await h.service.update('rule-1', USER, { isActive: true });
    expect(h.rules.get('rule-1').activeSince).toBe('2027-01');
    expect(h.debts.has('rule-1:2026-11')).toBe(false);
    expect(h.debts.has('rule-1:2026-12')).toBe(false);
  });

  it('honors individual exclusions in materialization and budget projection', async () => {
    const h = harness();
    await h.service.create(USER, {
      title: 'Internet',
      amount: 100,
      dayOfMonth: 10,
      firstOccurrence: '2026-10',
    });
    h.exclusions.add('rule-1:2026-11');
    expect(await h.service.reconcileForUserPeriod(USER, 11, 2026)).toEqual({
      month: '2026-11',
      created: 0,
    });
    expect(
      await h.service.projectMissingOccurrencesForMonth(USER, '2026-11'),
    ).toEqual([]);
    const projected = await h.service.projectMissingOccurrencesForMonth(
      USER,
      '2026-12',
    );
    expect(projected).toHaveLength(1);
    expect(projected[0].dueDate.toISOString().slice(0, 10)).toBe('2026-12-10');
  });

  it('uses the account civil day at resume boundary', () => {
    expect(
      recurringExpenseResumeMonth(7, new Date('2026-10-07T02:00:00Z'), ZONE),
    ).toBe('2026-10');
    expect(
      recurringExpenseResumeMonth(6, new Date('2026-10-07T12:00:00Z'), ZONE),
    ).toBe('2026-11');
  });
});
