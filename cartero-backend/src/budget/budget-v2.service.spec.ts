import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2PeriodPreset } from './budget-v2.types';

const money = (value: string) => new Prisma.Decimal(value);

describe('BudgetV2Service', () => {
  it("uses the authenticated user's account timezone", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
          expect(where).toEqual({ id: 'user-a' });
          expect(select).toEqual({ timeZone: true });
          return { timeZone: 'Asia/Tokyo' };
        }),
      },
    } as any;

    const service = new BudgetV2Service(prisma);
    const period = await service.getPeriod(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
    );

    expect(period.timeZone).toBe('Asia/Tokyo');
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it('aggregates realized authorities exactly once with Decimal money', async () => {
    const calls: any[] = [];
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async (args: any) => {
          calls.push({ source: 'transaction', args });
          return [
            {
              type: 'INCOME',
              amount: money('0.10'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'INCOME',
              amount: money('0.20'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: { userId: 'user-a' },
            },
            {
              type: 'PIX',
              amount: money('0.10'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'DEBIT_CARD',
              amount: money('0.20'),
              isRefund: false,
              paymentDebt: { userId: 'user-a' },
              paymentReceivable: null,
            },
            {
              type: 'BOLETO',
              amount: money('0.30'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'CREDIT_CARD',
              amount: money('100.00'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'CREDIT_CARD',
              amount: money('10.00'),
              isRefund: true,
              paymentDebt: null,
              paymentReceivable: null,
            },
          ];
        }),
      },
      invoiceSettlement: {
        findMany: vi.fn(async (args: any) => {
          calls.push({ source: 'settlement', args });
          return [{ amount: money('1.00') }];
        }),
      },
      personSettlementGroup: {
        findMany: vi.fn(async (args: any) => {
          calls.push({ source: 'group', args });
          return [
            {
              direction: 'INFLOW',
              paymentType: null,
              netAmount: money('0.40'),
            },
            {
              direction: 'OUTFLOW',
              paymentType: 'PIX',
              netAmount: money('0.50'),
            },
            {
              direction: 'OUTFLOW',
              paymentType: 'CREDIT_CARD',
              netAmount: money('0.60'),
            },
            { direction: 'NONE', paymentType: null, netAmount: money('0.70') },
          ];
        }),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(result.realized).toEqual({
      inflow: '0.70',
      outflow: '2.10',
      balance: '-1.40',
    });
    expect(result.composition.realized).toEqual({
      manualIncome: '0.10',
      receivableReceipts: '0.20',
      personSettlementInflows: '0.40',
      manualDirectTransactions: '0.40',
      debtDirectSettlements: '0.20',
      invoiceSettlements: '1.00',
      personSettlementDirectOutflows: '0.50',
    });
    expect(
      new Prisma.Decimal(result.composition.realized.manualIncome)
        .add(result.composition.realized.receivableReceipts)
        .add(result.composition.realized.personSettlementInflows)
        .toFixed(2),
    ).toBe(result.realized.inflow);
    expect(
      new Prisma.Decimal(result.composition.realized.manualDirectTransactions)
        .add(result.composition.realized.debtDirectSettlements)
        .add(result.composition.realized.invoiceSettlements)
        .add(result.composition.realized.personSettlementDirectOutflows)
        .toFixed(2),
    ).toBe(result.realized.outflow);

    const transactionQuery = calls.find(
      (call) => call.source === 'transaction',
    ).args;
    expect(transactionQuery.where.userId).toBe('user-a');
    expect(transactionQuery.where.date.gte).toEqual(
      new Date('2026-08-18T03:00:00.000Z'),
    );
    expect(transactionQuery.where.date.lt).toEqual(
      new Date('2026-09-17T03:00:00.000Z'),
    );
    expect(
      calls.find((call) => call.source === 'settlement').args.where,
    ).toMatchObject({
      invoice: { userId: 'user-a' },
    });
  });

  it('does not fabricate events from legacy paid fields or future records', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      debt: {
        findMany: vi.fn(async () => [
          { amount: money('500.00'), isPaid: true, paidAt: new Date() },
        ]),
      },
      receivable: {
        findMany: vi.fn(async () => [
          { amount: money('200.00'), isPaid: true, paidAt: new Date() },
        ]),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(result.realized).toEqual({
      inflow: '0.00',
      outflow: '0.00',
      balance: '0.00',
    });
  });

  it('does not classify a cross-user structural payment link as this user receipt', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async () => [
          {
            type: 'INCOME',
            amount: money('10.00'),
            isRefund: false,
            paymentDebt: null,
            paymentReceivable: { userId: 'user-b' },
          },
        ]),
      },
      invoiceSettlement: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.invoice.userId).toBe('user-a');
          return [];
        }),
      },
      personSettlementGroup: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [];
        }),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(result.composition.realized).toMatchObject({
      manualIncome: '10.00',
      receivableReceipts: '0.00',
    });
  });
});
