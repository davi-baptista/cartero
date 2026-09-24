import { TransactionType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  BudgetV2Bucket,
  classifyBudgetV2Debt,
  classifyBudgetV2Invoice,
  classifyBudgetV2PersonSettlement,
  classifyBudgetV2Receivable,
  classifyBudgetV2Transaction,
} from './budget-v2-classification.helper';
import { transactionBucketWhere } from './budget-v2-predicates.helper';

const TODAY = '2026-09-10';
const HORIZON = '2026-10-11';
const due = (day: string) => new Date(`${day}T12:00:00.000Z`);

describe('Budget V2 shared classification authority', () => {
  it('excludes settlement-linked Transactions from every generic realized bucket', () => {
    for (const bucket of [
      BudgetV2Bucket.MANUAL_INCOME,
      BudgetV2Bucket.RECEIVABLE_RECEIPTS,
      BudgetV2Bucket.DIRECT_EXPENSES,
      BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
    ]) {
      expect(
        transactionBucketWhere(bucket, 'user-a', {}).personSettlementGroupId,
      ).toBeNull();
    }
  });

  it('keeps receipts exclusive from manual income', () => {
    expect(
      classifyBudgetV2Transaction(
        {
          type: TransactionType.INCOME,
          isRefund: false,
          paymentReceivable: { userId: 'user-a' },
        },
        'user-a',
      ),
    ).toBe(BudgetV2Bucket.RECEIVABLE_RECEIPTS);
    expect(
      classifyBudgetV2Transaction(
        {
          type: TransactionType.INCOME,
          isRefund: false,
          paymentReceivable: null,
        },
        'user-a',
      ),
    ).toBe(BudgetV2Bucket.MANUAL_INCOME);
  });

  it('keeps debt settlement exclusive from direct expenses', () => {
    expect(
      classifyBudgetV2Transaction(
        {
          type: TransactionType.PIX,
          isRefund: false,
          paymentDebt: { userId: 'user-a' },
        },
        'user-a',
      ),
    ).toBe(BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS);
    expect(
      classifyBudgetV2Transaction(
        {
          type: TransactionType.PIX,
          isRefund: false,
          paymentDebt: null,
        },
        'user-a',
      ),
    ).toBe(BudgetV2Bucket.DIRECT_EXPENSES);
    expect(
      classifyBudgetV2Transaction(
        {
          type: TransactionType.CREDIT_CARD,
          isRefund: false,
        },
        'user-a',
      ),
    ).toBeNull();
  });

  it('classifies active settlement directions and excludes NONE/credit outflow', () => {
    expect(
      classifyBudgetV2PersonSettlement({
        direction: 'INFLOW',
        paymentType: null,
      }),
    ).toBe(BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW);
    expect(
      classifyBudgetV2PersonSettlement({
        direction: 'OUTFLOW',
        paymentType: TransactionType.BOLETO,
      }),
    ).toBe(BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW);
    expect(
      classifyBudgetV2PersonSettlement({
        direction: 'OUTFLOW',
        paymentType: TransactionType.CREDIT_CARD,
      }),
    ).toBeNull();
    expect(
      classifyBudgetV2PersonSettlement({
        direction: 'NONE',
        paymentType: null,
      }),
    ).toBeNull();
  });

  it('uses the exact upcoming and overdue civil-day boundaries', () => {
    expect(
      classifyBudgetV2Receivable(false, due('2026-09-09'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.OVERDUE_RECEIVABLES);
    expect(
      classifyBudgetV2Receivable(false, due('2026-09-10'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.UPCOMING_RECEIVABLES);
    expect(
      classifyBudgetV2Receivable(false, due('2026-10-10'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.UPCOMING_RECEIVABLES);
    expect(
      classifyBudgetV2Receivable(false, due('2026-10-11'), TODAY, HORIZON),
    ).toBeNull();
    expect(
      classifyBudgetV2Debt(true, due('2026-09-10'), TODAY, HORIZON),
    ).toBeNull();
  });

  it('classifies invoices by due date while excluding PAID', () => {
    expect(
      classifyBudgetV2Invoice('OPEN', due('2026-09-09'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.OVERDUE_OUTFLOWS);
    expect(
      classifyBudgetV2Invoice('CLOSED', due('2026-09-10'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.UPCOMING_INVOICES);
    expect(
      classifyBudgetV2Invoice('OVERDUE', due('2026-10-10'), TODAY, HORIZON),
    ).toBe(BudgetV2Bucket.UPCOMING_INVOICES);
    expect(
      classifyBudgetV2Invoice('PAID', due('2026-09-09'), TODAY, HORIZON),
    ).toBeNull();
  });
});
