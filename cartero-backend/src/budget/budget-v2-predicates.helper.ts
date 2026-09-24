import { InvoiceStatus, Prisma, TransactionType } from '@prisma/client';
import { BudgetV2Bucket } from './budget-v2-classification.helper';

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
        ],
      };
    case BudgetV2Bucket.RECEIVABLE_RECEIPTS:
      return {
        ...base,
        type: TransactionType.INCOME,
        paymentReceivable: { is: { userId } },
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
