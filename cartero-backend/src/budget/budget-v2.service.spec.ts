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
      receivable: { findMany: vi.fn(async () => []) },
      debt: { findMany: vi.fn(async () => []) },
      invoice: { findMany: vi.fn(async () => []) },
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
      debt: { findMany: vi.fn(async () => []) },
      receivable: { findMany: vi.fn(async () => []) },
      invoice: { findMany: vi.fn(async () => []) },
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
    expect(result.pending).toEqual({
      inflow: '0.00',
      outflow: '0.00',
      net: '0.00',
      overdue: { inflow: '0.00', outflow: '0.00' },
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
      receivable: { findMany: vi.fn(async () => []) },
      debt: { findMany: vi.fn(async () => []) },
      invoice: { findMany: vi.fn(async () => []) },
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

  it('aggregates open authorities and overdue as a subset using financial today', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [
            {
              amount: money('0.10'),
              dueDate: new Date('2026-09-16T12:00:00.000Z'),
            },
            {
              amount: money('0.20'),
              dueDate: new Date('2026-09-15T12:00:00.000Z'),
            },
            {
              amount: money('99.00'),
              dueDate: new Date('2026-09-15T12:00:00.000Z'),
            },
          ];
        }),
      },
      debt: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [
            {
              amount: money('0.20'),
              dueDate: new Date('2026-09-16T12:00:00.000Z'),
            },
            {
              amount: money('0.10'),
              dueDate: new Date('2026-09-15T12:00:00.000Z'),
            },
          ];
        }),
      },
      invoice: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [
            {
              totalAmount: money('0.20'),
              status: 'OPEN',
              dueDate: new Date('2026-09-16'),
            },
            {
              totalAmount: money('0.30'),
              status: 'CLOSED',
              dueDate: new Date('2026-09-15'),
            },
            {
              totalAmount: money('0.40'),
              status: 'OVERDUE',
              dueDate: new Date('2026-09-10'),
            },
          ];
        }),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(result.pending).toEqual({
      inflow: '99.30',
      outflow: '1.20',
      net: '98.10',
      overdue: { inflow: '99.20', outflow: '0.80' },
    });
    expect(result.composition.upcoming).toEqual({
      receivables: '0.10',
      debts: '0.20',
      invoices: '0.20',
    });
  });

  it('keeps current open and overdue state identical across realized presets', async () => {
    const openRows = {
      receivables: [
        {
          amount: money('200.00'),
          dueDate: new Date('2026-09-15T12:00:00.000Z'),
        },
      ],
      debts: [
        {
          amount: money('100.00'),
          dueDate: new Date('2026-09-20T12:00:00.000Z'),
        },
      ],
      invoices: [
        {
          totalAmount: money('500.00'),
          status: 'OPEN',
          dueDate: new Date('2026-09-20'),
        },
      ],
    };
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return openRows.receivables;
        }),
      },
      debt: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return openRows.debts;
        }),
      },
      invoice: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return openRows.invoices;
        }),
      },
    } as any;
    const service = new BudgetV2Service(prisma);
    const presets = [
      BudgetV2PeriodPreset.LAST_30_DAYS,
      BudgetV2PeriodPreset.THIS_MONTH,
      BudgetV2PeriodPreset.LAST_MONTH,
      BudgetV2PeriodPreset.ALL_TIME,
    ];
    const results = await Promise.all(
      presets.map((preset) =>
        service.getBudget(
          'user-a',
          preset,
          new Date('2026-09-16T12:00:00.000Z'),
        ),
      ),
    );

    for (const result of results.slice(1)) {
      expect(result.pending).toEqual(results[0].pending);
      expect(result.composition.upcoming).toEqual(
        results[0].composition.upcoming,
      );
      expect(result.pending.overdue).toEqual(results[0].pending.overdue);
    }
  });

  it('integrates every realized and open authority in one complete response', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [
            {
              type: 'INCOME',
              amount: money('1000.00'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'INCOME',
              amount: money('200.00'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: { userId: 'user-a' },
            },
            {
              type: 'PIX',
              amount: money('300.00'),
              isRefund: false,
              paymentDebt: null,
              paymentReceivable: null,
            },
            {
              type: 'PIX',
              amount: money('100.00'),
              isRefund: false,
              paymentDebt: { userId: 'user-a' },
              paymentReceivable: null,
            },
          ];
        }),
      },
      invoiceSettlement: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.invoice.userId).toBe('user-a');
          return [{ amount: money('500.00') }];
        }),
      },
      personSettlementGroup: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where.userId).toBe('user-a');
          return [
            {
              direction: 'INFLOW',
              paymentType: null,
              netAmount: money('50.00'),
            },
            {
              direction: 'OUTFLOW',
              paymentType: 'PIX',
              netAmount: money('50.00'),
            },
          ];
        }),
      },
      receivable: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where).toEqual({ userId: 'user-a', isPaid: false });
          return [
            {
              amount: money('100.00'),
              dueDate: new Date('2026-09-15T12:00:00.000Z'),
            },
            {
              amount: money('200.00'),
              dueDate: new Date('2026-09-20T12:00:00.000Z'),
            },
          ];
        }),
      },
      debt: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where).toEqual({ userId: 'user-a', isPaid: false });
          return [
            {
              amount: money('50.00'),
              dueDate: new Date('2026-09-15T12:00:00.000Z'),
            },
            {
              amount: money('100.00'),
              dueDate: new Date('2026-09-20T12:00:00.000Z'),
            },
          ];
        }),
      },
      invoice: {
        findMany: vi.fn(async ({ where }: any) => {
          expect(where).toEqual({
            userId: 'user-a',
            status: { in: ['OPEN', 'CLOSED', 'OVERDUE'] },
          });
          return [
            {
              totalAmount: money('400.00'),
              status: 'OPEN',
              dueDate: new Date('2026-09-20'),
            },
            {
              totalAmount: money('200.00'),
              status: 'OVERDUE',
              dueDate: new Date('2026-09-10'),
            },
          ];
        }),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.THIS_MONTH,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(result.realized).toEqual({
      inflow: '1250.00',
      outflow: '950.00',
      balance: '300.00',
    });
    expect(result.composition.realized).toEqual({
      manualIncome: '1000.00',
      receivableReceipts: '200.00',
      personSettlementInflows: '50.00',
      manualDirectTransactions: '300.00',
      debtDirectSettlements: '100.00',
      invoiceSettlements: '500.00',
      personSettlementDirectOutflows: '50.00',
    });
    expect(result.pending).toEqual({
      inflow: '300.00',
      outflow: '750.00',
      net: '-450.00',
      overdue: { inflow: '100.00', outflow: '250.00' },
    });
    expect(result.composition.upcoming).toEqual({
      invoices: '400.00',
      debts: '100.00',
      receivables: '200.00',
    });
    expect(result.period).toEqual({
      preset: BudgetV2PeriodPreset.THIS_MONTH,
      startDate: '2026-09-01',
      endDate: '2026-10-01',
      timeZone: 'America/Sao_Paulo',
    });
    expect(Object.keys(result).sort()).toEqual([
      'composition',
      'pending',
      'period',
      'realized',
      'resultAfterPending',
    ]);
    expect(result).not.toHaveProperty('future');
    expect(result).not.toHaveProperty('projection');
    expect(result).not.toHaveProperty('estimatedBalance');
    expect(result).not.toHaveProperty('bankBalance');
    expect(result).not.toHaveProperty('salary');
  });

  it('keeps a third-party reimbursement gross across its lifecycle', async () => {
    let receiptRecorded = false;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async () =>
          receiptRecorded
            ? [
                {
                  type: 'PIX',
                  amount: money('500.00'),
                  isRefund: false,
                  paymentDebt: null,
                  paymentReceivable: null,
                },
                {
                  type: 'INCOME',
                  amount: money('200.00'),
                  isRefund: false,
                  paymentDebt: null,
                  paymentReceivable: { userId: 'user-a' },
                },
              ]
            : [
                {
                  type: 'PIX',
                  amount: money('500.00'),
                  isRefund: false,
                  paymentDebt: null,
                  paymentReceivable: null,
                },
              ],
        ),
      },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: {
        findMany: vi.fn(async () =>
          receiptRecorded
            ? []
            : [
                {
                  amount: money('200.00'),
                  dueDate: new Date('2026-09-20T12:00:00.000Z'),
                },
              ],
        ),
      },
      debt: { findMany: vi.fn(async () => []) },
      invoice: { findMany: vi.fn(async () => []) },
    } as any;
    const service = new BudgetV2Service(prisma);

    const beforeReceipt = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T12:00:00.000Z'),
    );
    expect(beforeReceipt.realized).toMatchObject({
      outflow: '500.00',
      balance: '-500.00',
    });
    expect(beforeReceipt.pending.inflow).toBe('200.00');

    receiptRecorded = true;
    const afterReceipt = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T12:00:00.000Z'),
    );
    expect(afterReceipt.realized).toMatchObject({
      inflow: '200.00',
      outflow: '500.00',
      balance: '-300.00',
    });
    expect(afterReceipt.pending.inflow).toBe('0.00');
  });

  it('migrates debt authority from open to direct or invoice settlement exactly once', async () => {
    let directSettled = false;
    let creditSettled = false;
    let invoicePaid = false;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async () => {
          if (directSettled) {
            return [
              {
                type: 'PIX',
                amount: money('100.00'),
                isRefund: false,
                paymentDebt: { userId: 'user-a' },
                paymentReceivable: null,
              },
            ];
          }
          if (creditSettled) {
            return [
              {
                type: 'CREDIT_CARD',
                amount: money('100.00'),
                isRefund: false,
                paymentDebt: { userId: 'user-a' },
                paymentReceivable: null,
              },
            ];
          }
          return [];
        }),
      },
      invoiceSettlement: {
        findMany: vi.fn(async () =>
          invoicePaid ? [{ amount: money('100.00') }] : [],
        ),
      },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: { findMany: vi.fn(async () => []) },
      debt: {
        findMany: vi.fn(async () =>
          directSettled || creditSettled
            ? []
            : [{ amount: money('100.00'), dueDate: new Date('2026-09-20') }],
        ),
      },
      invoice: {
        findMany: vi.fn(async () =>
          creditSettled && !invoicePaid
            ? [
                {
                  totalAmount: money('100.00'),
                  status: 'OPEN',
                  dueDate: new Date('2026-09-20'),
                },
              ]
            : [],
        ),
      },
    } as any;
    const service = new BudgetV2Service(prisma);
    const now = new Date('2026-09-16T12:00:00.000Z');

    expect(
      (await service.getBudget('user-a', BudgetV2PeriodPreset.ALL_TIME, now))
        .pending.outflow,
    ).toBe('100.00');
    directSettled = true;
    const direct = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(direct.pending.outflow).toBe('0.00');
    expect(direct.composition.realized.debtDirectSettlements).toBe('100.00');

    directSettled = false;
    creditSettled = true;
    const credit = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(credit.realized.outflow).toBe('0.00');
    expect(credit.pending.outflow).toBe('100.00');
    invoicePaid = true;
    const invoice = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(invoice.pending.outflow).toBe('0.00');
    expect(invoice.composition.realized.invoiceSettlements).toBe('100.00');
  });

  it('keeps direct group settlement out of open and restores members after undo', async () => {
    let settled = false;
    let reversed = false;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: {
        findMany: vi.fn(async () =>
          settled && !reversed
            ? [
                {
                  direction: 'OUTFLOW',
                  paymentType: 'PIX',
                  netAmount: money('50.00'),
                },
              ]
            : [],
        ),
      },
      receivable: {
        findMany: vi.fn(async () =>
          settled && !reversed
            ? []
            : [{ amount: money('200.00'), dueDate: new Date('2026-09-20') }],
        ),
      },
      debt: {
        findMany: vi.fn(async () =>
          settled && !reversed
            ? []
            : [{ amount: money('250.00'), dueDate: new Date('2026-09-20') }],
        ),
      },
      invoice: { findMany: vi.fn(async () => []) },
    } as any;
    const service = new BudgetV2Service(prisma);
    const now = new Date('2026-09-16T12:00:00.000Z');

    const before = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(before.pending).toMatchObject({
      inflow: '200.00',
      outflow: '250.00',
    });
    settled = true;
    const after = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(after.pending).toMatchObject({ inflow: '0.00', outflow: '0.00' });
    expect(after.composition.realized.personSettlementDirectOutflows).toBe(
      '50.00',
    );
    reversed = true;
    const undo = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(undo.pending).toMatchObject({ inflow: '200.00', outflow: '250.00' });
    expect(undo.realized.outflow).toBe('0.00');
  });

  it('migrates a credit group settlement to one invoice authority', async () => {
    let creditSettled = false;
    let invoicePaid = false;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: {
        findMany: vi.fn(async () =>
          invoicePaid ? [{ amount: money('50.00') }] : [],
        ),
      },
      personSettlementGroup: {
        findMany: vi.fn(async () =>
          creditSettled && !invoicePaid
            ? [
                {
                  direction: 'OUTFLOW',
                  paymentType: 'CREDIT_CARD',
                  netAmount: money('50.00'),
                },
              ]
            : [],
        ),
      },
      receivable: {
        findMany: vi.fn(async () =>
          creditSettled
            ? []
            : [{ amount: money('200.00'), dueDate: new Date('2026-09-20') }],
        ),
      },
      debt: {
        findMany: vi.fn(async () =>
          creditSettled
            ? []
            : [{ amount: money('250.00'), dueDate: new Date('2026-09-20') }],
        ),
      },
      invoice: {
        findMany: vi.fn(async () =>
          creditSettled && !invoicePaid
            ? [
                {
                  totalAmount: money('50.00'),
                  status: 'OPEN',
                  dueDate: new Date('2026-09-20'),
                },
              ]
            : [],
        ),
      },
    } as any;
    const service = new BudgetV2Service(prisma);
    const now = new Date('2026-09-16T12:00:00.000Z');

    const before = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(before.pending).toMatchObject({
      inflow: '200.00',
      outflow: '250.00',
    });
    creditSettled = true;
    const credit = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(credit.pending.outflow).toBe('50.00');
    expect(credit.realized.outflow).toBe('0.00');
    invoicePaid = true;
    const invoice = await service.getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      now,
    );
    expect(invoice.pending.outflow).toBe('0.00');
    expect(invoice.composition.realized.invoiceSettlements).toBe('50.00');
  });

  it('keeps ALL_TIME historical bounds and open future obligations separate', async () => {
    let transactionDate: any;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async ({ where }: any) => {
          transactionDate = where.date;
          return [];
        }),
      },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: { findMany: vi.fn(async () => []) },
      debt: {
        findMany: vi.fn(async () => [
          { amount: money('100.00'), dueDate: new Date('2026-12-20') },
        ]),
      },
      invoice: { findMany: vi.fn(async () => []) },
    } as any;
    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-16T02:00:00.000Z'),
    );

    expect(transactionDate.lt).toEqual(new Date('2026-09-16T03:00:00.000Z'));
    expect(result.realized).toEqual({
      inflow: '0.00',
      outflow: '0.00',
      balance: '0.00',
    });
    expect(result.pending.outflow).toBe('0.00');
  });

  it('partitions every authority by dueDate, including stale invoice statuses', async () => {
    const due = (offset: number) =>
      new Date(Date.UTC(2026, 8, 10 + offset, 12));
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn(async () => []) },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: {
        findMany: vi.fn(async () => [
          { amount: money('1.00'), dueDate: due(-1) },
          { amount: money('2.00'), dueDate: due(0) },
          { amount: money('3.00'), dueDate: due(1) },
          { amount: money('4.00'), dueDate: due(9) },
          { amount: money('5.00'), dueDate: due(10) },
          { amount: money('500000.00'), dueDate: due(11) },
        ]),
      },
      debt: {
        findMany: vi.fn(async () => [
          { amount: money('10.00'), dueDate: due(-1) },
          { amount: money('20.00'), dueDate: due(0) },
          { amount: money('30.00'), dueDate: due(1) },
          { amount: money('40.00'), dueDate: due(9) },
          { amount: money('50.00'), dueDate: due(10) },
          {
            amount: money('500000.00'),
            dueDate: new Date('2030-01-01T12:00:00.000Z'),
          },
        ]),
      },
      invoice: {
        findMany: vi.fn(async () => [
          { totalAmount: money('100.00'), status: 'CLOSED', dueDate: due(-1) },
          { totalAmount: money('200.00'), status: 'OPEN', dueDate: due(-1) },
          { totalAmount: money('300.00'), status: 'OPEN', dueDate: due(0) },
          { totalAmount: money('400.00'), status: 'CLOSED', dueDate: due(1) },
          { totalAmount: money('500.00'), status: 'OPEN', dueDate: due(29) },
          { totalAmount: money('600.00'), status: 'CLOSED', dueDate: due(30) },
          { totalAmount: money('700.00'), status: 'OPEN', dueDate: due(31) },
          { totalAmount: money('999.00'), status: 'PAID', dueDate: due(-1) },
        ]),
      },
    } as any;

    const result = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
      new Date('2026-09-10T12:00:00.000Z'),
    );

    expect(result.pending).toEqual({
      inflow: '15.00',
      outflow: '2250.00',
      net: '-2235.00',
      overdue: { inflow: '1.00', outflow: '310.00' },
    });
    expect(result.composition.upcoming).toEqual({
      receivables: '14.00',
      debts: '140.00',
      invoices: '1800.00',
    });
    expect(result.resultAfterPending).toBe('-2235.00');
    expect(result.pending.inflow).toBe('15.00');
    expect(result.pending.overdue.inflow).toBe('1.00');
  });

  it('rejects an invalid preset before starting aggregation queries', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: { findMany: vi.fn() },
      invoiceSettlement: { findMany: vi.fn() },
      personSettlementGroup: { findMany: vi.fn() },
      receivable: { findMany: vi.fn() },
      debt: { findMany: vi.fn() },
      invoice: { findMany: vi.fn() },
    } as any;

    await expect(
      new BudgetV2Service(prisma).getBudget(
        'user-a',
        'INVALID' as BudgetV2PeriodPreset,
        new Date('2026-09-16T12:00:00.000Z'),
      ),
    ).rejects.toThrow();
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(prisma.receivable.findMany).not.toHaveBeenCalled();
  });
});
