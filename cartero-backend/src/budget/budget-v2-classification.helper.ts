import { TransactionType } from '@prisma/client';

export enum BudgetV2Bucket {
  MANUAL_INCOME = 'MANUAL_INCOME',
  RECEIVABLE_RECEIPTS = 'RECEIVABLE_RECEIPTS',
  PERSON_SETTLEMENT_INFLOW = 'PERSON_SETTLEMENT_INFLOW',
  DIRECT_EXPENSES = 'DIRECT_EXPENSES',
  DEBT_DIRECT_SETTLEMENTS = 'DEBT_DIRECT_SETTLEMENTS',
  INVOICE_SETTLEMENTS = 'INVOICE_SETTLEMENTS',
  PERSON_SETTLEMENT_DIRECT_OUTFLOW = 'PERSON_SETTLEMENT_DIRECT_OUTFLOW',
  UPCOMING_RECEIVABLES = 'UPCOMING_RECEIVABLES',
  UPCOMING_INVOICES = 'UPCOMING_INVOICES',
  UPCOMING_DEBTS = 'UPCOMING_DEBTS',
  OVERDUE_RECEIVABLES = 'OVERDUE_RECEIVABLES',
  OVERDUE_OUTFLOWS = 'OVERDUE_OUTFLOWS',
}

export type BudgetV2Transaction = {
  type: TransactionType;
  isRefund: boolean;
  paymentDebt?: { userId: string } | null;
  paymentReceivable?: { userId: string } | null;
};

export type BudgetV2PersonSettlementGroup = {
  direction: 'INFLOW' | 'OUTFLOW' | 'NONE';
  paymentType: TransactionType | null;
};

export type BudgetV2DueState = 'upcoming' | 'overdue' | 'outside';

const DIRECT_TRANSACTION_TYPES: TransactionType[] = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.BOLETO,
];

export function classifyBudgetV2Transaction(
  transaction: BudgetV2Transaction,
  userId: string,
): BudgetV2Bucket | null {
  if (transaction.isRefund) return null;

  if (transaction.type === TransactionType.INCOME) {
    return transaction.paymentReceivable?.userId === userId
      ? BudgetV2Bucket.RECEIVABLE_RECEIPTS
      : BudgetV2Bucket.MANUAL_INCOME;
  }

  if (!DIRECT_TRANSACTION_TYPES.includes(transaction.type)) return null;

  return transaction.paymentDebt?.userId === userId
    ? BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS
    : BudgetV2Bucket.DIRECT_EXPENSES;
}

export function classifyBudgetV2PersonSettlement(
  group: BudgetV2PersonSettlementGroup,
): BudgetV2Bucket | null {
  if (group.direction === 'INFLOW') {
    return BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW;
  }

  if (
    group.direction === 'OUTFLOW' &&
    group.paymentType &&
    DIRECT_TRANSACTION_TYPES.includes(group.paymentType)
  ) {
    return BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW;
  }

  return null;
}

export function classifyBudgetV2DueDate(
  dueDate: Date,
  today: string,
  horizonExclusive: string,
): BudgetV2DueState {
  const dueDay = dueDate.toISOString().slice(0, 10);
  if (dueDay < today) return 'overdue';
  if (dueDay < horizonExclusive) return 'upcoming';
  return 'outside';
}

export function classifyBudgetV2Invoice(
  status: string,
  dueDate: Date,
  today: string,
  horizonExclusive: string,
): BudgetV2Bucket | null {
  if (status === 'PAID') return null;

  const state = classifyBudgetV2DueDate(dueDate, today, horizonExclusive);
  if (state === 'upcoming') return BudgetV2Bucket.UPCOMING_INVOICES;
  if (state === 'overdue') return BudgetV2Bucket.OVERDUE_OUTFLOWS;
  return null;
}

export function classifyBudgetV2Receivable(
  isPaid: boolean,
  dueDate: Date,
  today: string,
  horizonExclusive: string,
): BudgetV2Bucket | null {
  if (isPaid) return null;

  const state = classifyBudgetV2DueDate(dueDate, today, horizonExclusive);
  if (state === 'upcoming') return BudgetV2Bucket.UPCOMING_RECEIVABLES;
  if (state === 'overdue') return BudgetV2Bucket.OVERDUE_RECEIVABLES;
  return null;
}

export function classifyBudgetV2Debt(
  isPaid: boolean,
  dueDate: Date,
  today: string,
  horizonExclusive: string,
): BudgetV2Bucket | null {
  if (isPaid) return null;

  const state = classifyBudgetV2DueDate(dueDate, today, horizonExclusive);
  if (state === 'upcoming') return BudgetV2Bucket.UPCOMING_DEBTS;
  if (state === 'overdue') return BudgetV2Bucket.OVERDUE_OUTFLOWS;
  return null;
}
