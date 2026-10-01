import { InvoiceStatus, Prisma, TransactionType } from '@prisma/client';
import {
  BUDGET_V2_RECEIPT_CLASSIFICATIONS,
  BudgetV2Bucket,
} from './budget-v2-classification.helper';
import type { BudgetV2Period } from './budget-v2.types';
import { financialCivilDateStart } from 'src/common/helpers/financial-period.helper';

export const DIRECT_PAYMENT_TYPES = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.BOLETO,
] as const;

export function transactionBucketWhere(
  bucket: BudgetV2Bucket,
  userId: string,
  date: Prisma.DateTimeFilter,
): Prisma.TransactionWhereInput {
  const base = { userId, date, isRefund: false, personSettlementGroupId: null };

  switch (bucket) {
    case BudgetV2Bucket.MANUAL_INCOME:
      return {
        ...base,
        type: TransactionType.INCOME,
        OR: [
          { paymentReceivable: { is: null } },
          { paymentReceivable: { isNot: { userId } } },
          {
            paymentReceivable: {
              is: { userId, incomeClassification: 'INCOME' },
            },
          },
          {
            paymentReceivable: {
              is: { userId, recurringIncomeRuleId: { not: null } },
            },
          },
        ],
      };
    case BudgetV2Bucket.RECEIVABLE_RECEIPTS:
      return {
        ...base,
        type: TransactionType.INCOME,
        paymentReceivable: {
          is: {
            userId,
            AND: [
              {
                OR: BUDGET_V2_RECEIPT_CLASSIFICATIONS.map(
                  (incomeClassification) => ({ incomeClassification }),
                ),
              },
              { recurringIncomeRuleId: null },
            ],
          },
        },
      };
    case BudgetV2Bucket.DIRECT_EXPENSES:
      return {
        ...base,
        type: { in: [...DIRECT_PAYMENT_TYPES] },
        OR: [
          { paymentDebt: { is: null } },
          { paymentDebt: { isNot: { userId } } },
        ],
      };
    case BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS:
      return {
        ...base,
        type: { in: [...DIRECT_PAYMENT_TYPES] },
        paymentDebt: { is: { userId } },
      };
    default:
      throw new Error(`Unsupported transaction bucket: ${bucket}`);
  }
}

export function settlementBucketWhere(
  bucket: BudgetV2Bucket,
  userId: string,
  settledAt: Prisma.DateTimeFilter,
): Prisma.PersonSettlementGroupWhereInput {
  const base = { userId, status: 'ACTIVE' as const, settledAt };

  switch (bucket) {
    case BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW:
      return { ...base, direction: 'INFLOW' };
    case BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW:
      return {
        ...base,
        direction: 'OUTFLOW',
        paymentType: { in: [...DIRECT_PAYMENT_TYPES] },
      };
    default:
      throw new Error(`Unsupported settlement bucket: ${bucket}`);
  }
}

export function invoiceSettlementWhere(
  userId: string,
  paidAt: Prisma.DateTimeFilter,
): Prisma.InvoiceSettlementWhereInput {
  return { invoice: { userId }, paidAt };
}

export function receivableBucketWhere(
  userId: string,
  dueDate: Prisma.DateTimeFilter,
): Prisma.ReceivableWhereInput {
  return { userId, isPaid: false, dueDate };
}

export function debtBucketWhere(
  userId: string,
  dueDate: Prisma.DateTimeFilter,
): Prisma.DebtWhereInput {
  return { userId, isPaid: false, dueDate };
}

export function invoiceBucketWhere(
  userId: string,
  dueDate: Prisma.DateTimeFilter,
): Prisma.InvoiceWhereInput {
  return {
    userId,
    status: {
      in: [InvoiceStatus.OPEN, InvoiceStatus.CLOSED, InvoiceStatus.OVERDUE],
    },
    dueDate,
  };
}

function civilDateStart(date: string): Date {
  return financialCivilDateStart(date);
}

export function unresolvedDueDateWhere(
  userId: string,
  period: BudgetV2Period,
  today: string,
): { userId: string; OR: Array<Record<string, unknown>> } {
  const todayDate = civilDateStart(today);
  const overdue = { dueDate: { lt: todayDate } };
  if (period.startDate === null) {
    return { userId, OR: [overdue, { dueDate: { gte: todayDate } }] };
  }

  const start = period.startDate > today ? period.startDate : today;
  const normal =
    start < period.endDate
      ? {
          dueDate: {
            gte: civilDateStart(start),
            lt: civilDateStart(period.endDate),
          },
        }
      : {
          dueDate: {
            gte: civilDateStart(period.endDate),
            lt: civilDateStart(period.endDate),
          },
        };
  return { userId, OR: [overdue, normal] };
}
