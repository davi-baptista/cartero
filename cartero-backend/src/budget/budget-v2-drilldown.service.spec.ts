import { Prisma, TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2DrilldownService } from './budget-v2-drilldown.service';
import { BudgetV2Bucket } from './budget-v2-classification.helper';
import { BudgetV2PeriodPreset } from './budget-v2.types';

const money = (value: string) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

function createPrisma() {
  const transactions = [
    {
      id: 'tx-income',
      type: TransactionType.INCOME,
      amount: money('10.00'),
      date: date('2026-09-01'),
      isRefund: false,
      title: 'Salário',
      description: null,
      bank: { name: 'Inter' },
      category: { name: 'Renda' },
      paymentDebt: null,
      paymentReceivable: null,
    },
    {
      id: 'tx-receipt',
      type: TransactionType.INCOME,
      amount: money('20.00'),
      date: date('2026-09-02'),
      isRefund: false,
      title: 'Recebimento',
      description: 'Parcela',
      bank: { name: 'Nubank' },
      category: { name: 'Recebíveis' },
      paymentDebt: null,
      paymentReceivable: {
        id: 'rec-received',
        userId: 'user-a',
        title: 'Parcela',
        description: 'Parcela',
        debtorName: 'Cliente',
        person: { name: 'Cliente' },
      },
    },
    {
      id: 'tx-expense',
      type: TransactionType.PIX,
      amount: money('30.00'),
      date: date('2026-09-03'),
      isRefund: false,
      title: 'Mercado',
      description: null,
      bank: { name: 'Inter' },
      category: { name: 'Casa' },
      paymentDebt: null,
      paymentReceivable: null,
    },
    {
      id: 'tx-debt',
      type: TransactionType.DEBIT_CARD,
      amount: money('40.00'),
      date: date('2026-09-04'),
      isRefund: false,
      title: 'Dívida paga',
      description: 'Empréstimo',
      bank: { name: 'Inter' },
      category: { name: 'Dívidas' },
      paymentDebt: {
        id: 'debt-paid',
        userId: 'user-a',
        title: 'Empréstimo',
        description: 'Empréstimo',
        creditorName: 'João',
        person: { name: 'João' },
      },
      paymentReceivable: null,
    },
  ];

  const groups = [
    {
      id: 'group-in',
      userId: 'user-a',
      status: 'ACTIVE',
      direction: 'INFLOW',
      paymentType: null,
      netAmount: money('50.00'),
      settledAt: date('2026-09-05'),
      person: { name: 'Maria' },
      bank: null,
    },
    {
      id: 'group-out',
      userId: 'user-a',
      status: 'ACTIVE',
      direction: 'OUTFLOW',
      paymentType: TransactionType.PIX,
      netAmount: money('60.00'),
      settledAt: date('2026-09-06'),
      person: { name: 'Pedro' },
      bank: { name: 'Inter' },
    },
    {
      id: 'group-credit',
      userId: 'user-a',
      status: 'ACTIVE',
      direction: 'OUTFLOW',
      paymentType: TransactionType.CREDIT_CARD,
      netAmount: money('70.00'),
      settledAt: date('2026-09-06'),
      person: { name: 'Cartão' },
      bank: { name: 'Nubank' },
    },
    {
      id: 'group-reversed',
      userId: 'user-a',
      status: 'REVERSED',
      direction: 'INFLOW',
      paymentType: null,
      netAmount: money('999.00'),
      settledAt: date('2026-09-06'),
      person: { name: 'Revertido' },
      bank: null,
    },
  ];

  const receivables = [
    {
      id: 'rec-overdue',
      userId: 'user-a',
      amount: money('80.00'),
      dueDate: date('2026-09-09'),
      title: 'Atrasado',
      description: null,
      debtorName: 'Ana',
      isPaid: false,
      person: { name: 'Ana' },
    },
    {
      id: 'rec-upcoming',
      userId: 'user-a',
      amount: money('90.00'),
      dueDate: date('2026-09-30'),
      title: 'A vencer',
      description: 'Setembro',
      debtorName: 'Bia',
      isPaid: false,
      person: { name: 'Bia' },
    },
    {
      id: 'rec-plus31',
      userId: 'user-a',
      amount: money('1000.00'),
      dueDate: date('2026-10-11'),
      title: 'Futuro',
      description: null,
      debtorName: 'Futuro',
      isPaid: false,
      person: null,
    },
    {
      id: 'rec-paid',
      userId: 'user-a',
      amount: money('1001.00'),
      dueDate: date('2026-09-09'),
      title: 'Pago antigo',
      description: null,
      debtorName: 'Pago',
      isPaid: true,
      person: null,
    },
  ];

  const debts = [
    {
      id: 'debt-overdue',
      userId: 'user-a',
      amount: money('110.00'),
      dueDate: date('2026-09-08'),
      title: 'Dívida atrasada',
      description: null,
      creditorName: 'Carlos',
      isPaid: false,
      person: { name: 'Carlos' },
    },
    {
      id: 'debt-upcoming',
      userId: 'user-a',
      amount: money('120.00'),
      dueDate: date('2026-10-10'),
      title: 'Dívida futura',
      description: 'Outubro',
      creditorName: 'Diana',
      isPaid: false,
      person: { name: 'Diana' },
    },
    {
      id: 'debt-plus31',
      userId: 'user-a',
      amount: money('1002.00'),
      dueDate: date('2026-10-11'),
      title: 'Dívida distante',
      description: null,
      creditorName: 'Distante',
      isPaid: false,
      person: null,
    },
    {
      id: 'debt-paid',
      userId: 'user-a',
      amount: money('1003.00'),
      dueDate: date('2026-09-08'),
      title: 'Dívida paga',
      description: null,
      creditorName: 'Pago',
      isPaid: true,
      person: null,
    },
  ];

  const invoices = [
    {
      id: 'invoice-overdue-open',
      userId: 'user-a',
      totalAmount: money('130.00'),
      dueDate: date('2026-09-07'),
      month: 8,
      year: 2026,
      status: 'OPEN',
      bank: { name: 'Inter' },
    },
    {
      id: 'invoice-overdue-closed',
      userId: 'user-a',
      totalAmount: money('140.00'),
      dueDate: date('2026-09-09'),
      month: 8,
      year: 2026,
      status: 'CLOSED',
      bank: { name: 'Nubank' },
    },
    {
      id: 'invoice-inter',
      userId: 'user-a',
      totalAmount: money('150.00'),
      dueDate: date('2026-09-30'),
      month: 9,
      year: 2026,
      status: 'OPEN',
      bank: { name: 'Inter' },
    },
    {
      id: 'invoice-nubank',
      userId: 'user-a',
      totalAmount: money('160.00'),
      dueDate: date('2026-10-05'),
      month: 10,
      year: 2026,
      status: 'CLOSED',
      bank: { name: 'Nubank' },
    },
    {
      id: 'invoice-paid',
      userId: 'user-a',
      totalAmount: money('1004.00'),
      dueDate: date('2026-09-08'),
      month: 8,
      year: 2026,
      status: 'PAID',
      bank: { name: 'Inter' },
    },
  ];

  const settlements = [
    {
      id: 'settlement-invoice',
      invoiceId: 'invoice-settled',
      amount: money('70.00'),
      paidAt: date('2026-09-07'),
      invoice: {
        dueDate: date('2026-09-05'),
        month: 8,
        year: 2026,
        bank: { name: 'Inter' },
      },
    },
  ];

  return {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    transaction: {
      findMany: vi.fn(async () => transactions),
    },
    personSettlementGroup: {
      findMany: vi.fn(async (args: any) =>
        groups.filter(
          (group) =>
            args.where.status === group.status &&
            (!args.where.direction || args.where.direction === group.direction),
        ),
      ),
    },
    invoiceSettlement: {
      findMany: vi.fn(async () => settlements),
    },
    receivable: {
      findMany: vi.fn(async (args: any) =>
        args.where.isPaid === false
          ? receivables.filter((item) => !item.isPaid)
          : receivables,
      ),
    },
    debt: {
      findMany: vi.fn(async (args: any) =>
        args.where.isPaid === false
          ? debts.filter((item) => !item.isPaid)
          : debts,
      ),
    },
    invoice: {
      findMany: vi.fn(async (args: any) =>
        args.where.status?.in
          ? invoices.filter((item) =>
              args.where.status.in.includes(item.status),
            )
          : invoices,
      ),
    },
  } as any;
}

describe('BudgetV2DrilldownService', () => {
  it('reconciles all twelve buckets with the released summary', async () => {
    const prisma = createPrisma();
    const summary = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      date('2026-09-10'),
    );
    const service = new BudgetV2DrilldownService(prisma);
    const realizedBuckets = new Set([
      BudgetV2Bucket.MANUAL_INCOME,
      BudgetV2Bucket.RECEIVABLE_RECEIPTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW,
      BudgetV2Bucket.DIRECT_EXPENSES,
      BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
      BudgetV2Bucket.INVOICE_SETTLEMENTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
    ]);
    const cases = [
      [BudgetV2Bucket.MANUAL_INCOME, summary.composition.realized.manualIncome],
      [
        BudgetV2Bucket.RECEIVABLE_RECEIPTS,
        summary.composition.realized.receivableReceipts,
      ],
      [
        BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW,
        summary.composition.realized.personSettlementInflows,
      ],
      [
        BudgetV2Bucket.DIRECT_EXPENSES,
        summary.composition.realized.manualDirectTransactions,
      ],
      [
        BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
        summary.composition.realized.debtDirectSettlements,
      ],
      [
        BudgetV2Bucket.INVOICE_SETTLEMENTS,
        summary.composition.realized.invoiceSettlements,
      ],
      [
        BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
        summary.composition.realized.personSettlementDirectOutflows,
      ],
      [
        BudgetV2Bucket.UPCOMING_RECEIVABLES,
        summary.composition.upcoming.receivables,
      ],
      [BudgetV2Bucket.UPCOMING_INVOICES, summary.composition.upcoming.invoices],
      [BudgetV2Bucket.UPCOMING_DEBTS, summary.composition.upcoming.debts],
      [BudgetV2Bucket.OVERDUE_RECEIVABLES, summary.pending.overdue.inflow],
      [BudgetV2Bucket.OVERDUE_OUTFLOWS, summary.pending.overdue.outflow],
    ] as const;

    for (const [bucket, expected] of cases) {
      const response = await service.getDrilldown(
        'user-a',
        {
          bucket,
          ...(realizedBuckets.has(bucket)
            ? { preset: BudgetV2PeriodPreset.LAST_30_DAYS }
            : {}),
          limit: 100,
        } as any,
        date('2026-09-10'),
      );
      expect(response.total, bucket).toBe(expected);
      expect(
        response.items
          .reduce(
            (sum, item) => sum.add(new Prisma.Decimal(item.amount)),
            money('0'),
          )
          .toFixed(2),
        bucket,
      ).toBe(expected);
    }
  });

  it('keeps mixed-month upcoming invoices together and applies exact boundaries', async () => {
    const service = new BudgetV2DrilldownService(createPrisma());
    const response = await service.getDrilldown(
      'user-a',
      { bucket: BudgetV2Bucket.UPCOMING_INVOICES, limit: 100 } as any,
      date('2026-09-10'),
    );

    expect(response.items.map((item) => item.id)).toEqual([
      'invoice-inter',
      'invoice-nubank',
    ]);
    expect(response.items.map((item) => item.kind)).toEqual([
      'INVOICE',
      'INVOICE',
    ]);
    expect(response.total).toBe('310.00');
    expect(response.context.pendingWindow).toEqual({
      startDate: '2026-09-10',
      endDateExclusive: '2026-10-11',
    });
  });

  it('paginates heterogeneous overdue outflows without duplicates', async () => {
    const service = new BudgetV2DrilldownService(createPrisma());
    const first = await service.getDrilldown(
      'user-a',
      { bucket: BudgetV2Bucket.OVERDUE_OUTFLOWS, limit: 1 } as any,
      date('2026-09-10'),
    );
    const second = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.OVERDUE_OUTFLOWS,
        limit: 1,
        cursor: first.pageInfo.nextCursor!,
      } as any,
      date('2026-09-10'),
    );
    const third = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.OVERDUE_OUTFLOWS,
        limit: 1,
        cursor: second.pageInfo.nextCursor!,
      } as any,
      date('2026-09-10'),
    );

    expect(first.items.map((item) => item.id)).toEqual([
      'invoice-overdue-open',
    ]);
    expect(second.items.map((item) => item.id)).toEqual(['debt-overdue']);
    expect(third.items.map((item) => item.id)).toEqual([
      'invoice-overdue-closed',
    ]);
    expect(first.total).toBe('380.00');
    expect(second.total).toBe('380.00');
    expect(third.total).toBe('380.00');
    expect(third.pageInfo.nextCursor).toBeNull();
  });

  it('rejects invalid period scope and incompatible cursors', async () => {
    const service = new BudgetV2DrilldownService(createPrisma());

    await expect(
      service.getDrilldown('user-a', {
        bucket: BudgetV2Bucket.MANUAL_INCOME,
      } as any),
    ).rejects.toThrow('preset is required');
    await expect(
      service.getDrilldown('user-a', {
        bucket: BudgetV2Bucket.UPCOMING_DEBTS,
        preset: BudgetV2PeriodPreset.ALL_TIME,
      } as any),
    ).rejects.toThrow('preset is forbidden');
    await expect(
      service.getDrilldown('user-a', {
        bucket: BudgetV2Bucket.UPCOMING_DEBTS,
        cursor: 'not-a-cursor',
      } as any),
    ).rejects.toThrow('Invalid budget drilldown cursor');
  });

  it('applies authenticated-user scope to contributor queries', async () => {
    const prisma = createPrisma();
    const service = new BudgetV2DrilldownService(prisma);

    await service.getDrilldown(
      'user-a',
      { bucket: BudgetV2Bucket.UPCOMING_DEBTS } as any,
      date('2026-09-10'),
    );

    expect(prisma.debt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a', isPaid: false }),
      }),
    );
  });
});
