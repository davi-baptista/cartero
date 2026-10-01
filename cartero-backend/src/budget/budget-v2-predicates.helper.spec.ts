import { TransactionType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  classifyBudgetV2Transaction,
  BudgetV2Bucket,
} from './budget-v2-classification.helper';
import {
  transactionBucketWhere,
  unresolvedDueDateWhere,
} from './budget-v2-predicates.helper';
import { BudgetV2PeriodPreset } from './budget-v2.types';

type Where = Record<string, any>;

/** Evaluates the Prisma operators used by transactionBucketWhere. Scalar NOT
 * against NULL yields false (SQL UNKNOWN in WHERE); equality with null means
 * IS NULL, as Prisma translates it for Postgres. */
function matchesPrismaWhere(row: Where, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND')
      return condition.every((part: Where) => matchesPrismaWhere(row, part));
    if (key === 'OR')
      return condition.some((part: Where) => matchesPrismaWhere(row, part));
    if (key === 'NOT') return !matchesPrismaWhere(row, condition);

    const value = row[key];
    if (key === 'paymentReceivable') {
      if ('is' in condition) {
        return condition.is === null
          ? value == null
          : value != null && matchesPrismaWhere(value, condition.is);
      }
      if ('isNot' in condition) {
        return value == null || !matchesPrismaWhere(value, condition.isNot);
      }
    }
    if (
      condition &&
      typeof condition === 'object' &&
      !Array.isArray(condition)
    ) {
      if ('not' in condition) {
        return value != null && value !== condition.not;
      }
      if ('in' in condition) return condition.in.includes(value);
      if (
        'gte' in condition ||
        'gt' in condition ||
        'lte' in condition ||
        'lt' in condition
      ) {
        return true;
      }
      return matchesPrismaWhere(value ?? {}, condition);
    }
    if (condition === null) return value == null;
    return value === condition;
  });
}

const incomeMatrix = [
  {
    classification: null,
    recurringId: null,
    personId: null,
    expected: BudgetV2Bucket.RECEIVABLE_RECEIPTS,
  },
  {
    classification: 'OTHER',
    recurringId: null,
    personId: null,
    expected: BudgetV2Bucket.RECEIVABLE_RECEIPTS,
  },
  {
    classification: 'INCOME',
    recurringId: null,
    personId: null,
    expected: BudgetV2Bucket.MANUAL_INCOME,
  },
  {
    classification: null,
    recurringId: 'rule-1',
    personId: null,
    expected: BudgetV2Bucket.MANUAL_INCOME,
  },
  {
    classification: 'OTHER',
    recurringId: 'rule-1',
    personId: null,
    expected: BudgetV2Bucket.MANUAL_INCOME,
  },
  {
    classification: 'INCOME',
    recurringId: null,
    personId: 'person-1',
    expected: BudgetV2Bucket.MANUAL_INCOME,
  },
  {
    classification: 'OTHER',
    recurringId: null,
    personId: 'person-1',
    expected: BudgetV2Bucket.RECEIVABLE_RECEIPTS,
  },
  {
    classification: null,
    recurringId: null,
    personId: 'person-1',
    expected: BudgetV2Bucket.RECEIVABLE_RECEIPTS,
  },
] as const;

describe('Budget V2 civil due-date predicates', () => {
  it('classifies every time on today as pending and yesterday as overdue', () => {
    const where = unresolvedDueDateWhere(
      'user-1',
      {
        preset: BudgetV2PeriodPreset.THIS_MONTH,
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        timeZone: 'America/Sao_Paulo',
      },
      '2026-09-16',
    );

    expect(where.OR).toEqual([
      { dueDate: { lt: new Date('2026-09-16T00:00:00.000Z') } },
      {
        dueDate: {
          gte: new Date('2026-09-16T00:00:00.000Z'),
          lt: new Date('2026-10-01T00:00:00.000Z'),
        },
      },
    ]);
  });

  it('does not impose an upper bound on all-time pending due dates', () => {
    const where = unresolvedDueDateWhere(
      'user-1',
      {
        preset: BudgetV2PeriodPreset.ALL_TIME,
        startDate: null,
        endDate: '2026-09-17',
        timeZone: 'America/Sao_Paulo',
      },
      '2026-09-16',
    );
    expect(where.OR[1]).toEqual({
      dueDate: { gte: new Date('2026-09-16T00:00:00.000Z') },
    });
  });
});

describe('Budget V2 realized income WHERE parity', () => {
  const userId = 'user-a';
  const buckets = [
    BudgetV2Bucket.MANUAL_INCOME,
    BudgetV2Bucket.RECEIVABLE_RECEIPTS,
  ];

  it.each(incomeMatrix)(
    'matches classifier and exactly one SQL-semantic predicate for %#',
    ({ classification, recurringId, personId, expected }) => {
      const row = {
        userId,
        type: TransactionType.INCOME,
        isRefund: false,
        personSettlementGroupId: null,
        paymentReceivable: {
          userId,
          incomeClassification: classification,
          recurringIncomeRuleId: recurringId,
          personId,
        },
      };
      const summaryBucket = classifyBudgetV2Transaction(row as any, userId);
      const matchedBuckets = buckets.filter((bucket) =>
        matchesPrismaWhere(row, transactionBucketWhere(bucket, userId, {})),
      );

      expect(summaryBucket).toBe(expected);
      expect(matchedBuckets).toEqual([expected]);
    },
  );

  it('the former NOT INCOME predicate fails for SQL NULL and the current predicate includes it', () => {
    const row = {
      userId,
      type: TransactionType.INCOME,
      isRefund: false,
      personSettlementGroupId: null,
      paymentReceivable: {
        userId,
        incomeClassification: null,
        recurringIncomeRuleId: null,
        personId: null,
      },
    };
    const oldNullSensitiveWhere = {
      ...transactionBucketWhere(BudgetV2Bucket.RECEIVABLE_RECEIPTS, userId, {}),
      paymentReceivable: {
        is: {
          userId,
          personId: null,
          incomeClassification: { not: 'INCOME' },
          recurringIncomeRuleId: null,
        },
      },
    };
    expect(matchesPrismaWhere(row, oldNullSensitiveWhere)).toBe(false);
    expect(
      matchesPrismaWhere(
        row,
        transactionBucketWhere(BudgetV2Bucket.RECEIVABLE_RECEIPTS, userId, {}),
      ),
    ).toBe(true);
  });
});
