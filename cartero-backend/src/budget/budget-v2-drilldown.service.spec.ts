import { Prisma, TransactionType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2DrilldownService } from './budget-v2-drilldown.service';
import { BudgetV2Bucket } from './budget-v2-classification.helper';
import { BudgetV2PeriodPreset } from './budget-v2.types';

const money = (value: string) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

function equalValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  if (actual instanceof Prisma.Decimal || expected instanceof Prisma.Decimal) {
    return new Prisma.Decimal(String(actual)).eq(
      new Prisma.Decimal(String(expected)),
    );
  }
  return actual === expected;
}

function matchesValue(actual: any, condition: any): boolean {
  if (
    condition === null ||
    typeof condition !== 'object' ||
    condition instanceof Date
  ) {
    return equalValue(actual, condition);
  }
  if (condition.in)
    return condition.in.some((item: unknown) => equalValue(actual, item));
  if (condition.notIn)
    return !condition.notIn.some((item: unknown) => equalValue(actual, item));
  if (condition.gte && !(actual >= condition.gte)) return false;
  if (condition.gt && !(actual > condition.gt)) return false;
  if (condition.lte && !(actual <= condition.lte)) return false;
  if (condition.lt && !(actual < condition.lt)) return false;
  if ('not' in condition) return !matchesValue(actual, condition.not);
  if ('is' in condition)
    return condition.is === null
      ? actual === null
      : actual !== null && matchesWhere(actual, condition.is);
  if ('isNot' in condition)
    return actual === null || !matchesWhere(actual, condition.isNot);
  if (
    ['in', 'notIn', 'gte', 'gt', 'lte', 'lt'].some((key) => key in condition)
  ) {
    return true;
  }
  return Object.entries(condition).every(([key, value]) =>
    matchesValue(actual?.[key], value),
  );
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  if (where.AND && !where.AND.every((part: any) => matchesWhere(row, part)))
    return false;
  if (where.OR && !where.OR.some((part: any) => matchesWhere(row, part)))
    return false;
  return Object.entries(where)
    .filter(([key]) => key !== 'AND' && key !== 'OR')
    .every(([key, condition]) => matchesValue(row[key], condition));
}

function sortRows(rows: any[], orderBy: any[] = []) {
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0] as [string, string];
      const a =
        left[field] instanceof Date ? left[field].getTime() : left[field];
      const b =
        right[field] instanceof Date ? right[field].getTime() : right[field];
      if (a < b) return direction === 'asc' ? -1 : 1;
      if (a > b) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function model(rows: any[]) {
  const findMany = vi.fn(async (args: any = {}) =>
    sortRows(
      rows.filter((row) => matchesWhere(row, args.where)),
      args.orderBy,
    ).slice(0, args.take ?? rows.length),
  );
  const aggregate = vi.fn(async (args: any = {}) => {
    const matching = rows.filter((row) => matchesWhere(row, args.where));
    const field = Object.keys(args._sum ?? {})[0];
    return {
      _sum: {
        [field]: matching.length
          ? matching.reduce(
              (sum, row) => sum.add(new Prisma.Decimal(row[field])),
              money('0'),
            )
          : null,
      },
    };
  });
  return { findMany, aggregate };
}

function createPrisma() {
  const transactions = [
    {
      id: 'tx-income',
      userId: 'user-a',
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
      userId: 'user-a',
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
      userId: 'user-a',
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
      id: 'tx-expense-same-date',
      userId: 'user-a',
      type: TransactionType.PIX,
      amount: money('31.00'),
      date: date('2026-09-03'),
      isRefund: false,
      title: 'Farmácia',
      description: null,
      bank: { name: 'Inter' },
      category: { name: 'Saúde' },
      paymentDebt: null,
      paymentReceivable: null,
    },
    {
      id: 'tx-expense-foreign',
      userId: 'user-b',
      type: TransactionType.PIX,
      amount: money('999.00'),
      date: date('2026-09-03'),
      isRefund: false,
      title: 'Foreign expense',
      description: null,
      bank: { name: 'Inter' },
      category: { name: 'Casa' },
      paymentDebt: null,
      paymentReceivable: null,
    },
    {
      id: 'tx-debt',
      userId: 'user-a',
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
      id: 'debt-overdue-same-date',
      userId: 'user-a',
      amount: money('115.00'),
      dueDate: date('2026-09-09'),
      title: 'Outra dívida atrasada',
      description: null,
      creditorName: 'Elisa',
      isPaid: false,
      person: { name: 'Elisa' },
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
        userId: 'user-a',
        dueDate: date('2026-09-05'),
        month: 8,
        year: 2026,
        bank: { name: 'Inter' },
      },
    },
    {
      id: 'settlement-invoice-foreign',
      invoiceId: 'invoice-settled-foreign',
      amount: money('999.00'),
      paidAt: date('2026-09-08'),
      invoice: {
        userId: 'user-b',
        dueDate: date('2026-09-06'),
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
    transaction: model(transactions),
    personSettlementGroup: model(groups),
    invoiceSettlement: model(settlements),
    receivable: model(receivables),
    debt: model(debts),
    invoice: model(invoices),
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

  it('proves invoice settlement reconciliation is non-vacuous and relation-scoped', async () => {
    const prisma = createPrisma();
    const summary = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      date('2026-09-10'),
    );
    const service = new BudgetV2DrilldownService(prisma);
    const first = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.INVOICE_SETTLEMENTS,
        preset: BudgetV2PeriodPreset.LAST_30_DAYS,
        limit: 1,
      } as any,
      date('2026-09-10'),
    );
    expect(summary.composition.realized.invoiceSettlements).toBe('70.00');
    expect(summary.composition.realized.invoiceSettlements).not.toBe('0.00');
    expect(first.items.map((item) => item.id)).toEqual(['settlement-invoice']);
    expect(first.total).toBe('70.00');
    expect(
      first.items
        .reduce(
          (sum, item) => sum.add(new Prisma.Decimal(item.amount)),
          money('0'),
        )
        .toFixed(2),
    ).toBe('70.00');
    expect(first.pageInfo.hasMore).toBe(false);
  });

  it('excludes foreign direct and invoice-settlement contributors from pages and totals', async () => {
    const service = new BudgetV2DrilldownService(createPrisma());
    const direct = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.DIRECT_EXPENSES,
        preset: BudgetV2PeriodPreset.LAST_30_DAYS,
        limit: 10,
      } as any,
      date('2026-09-10'),
    );
    const invoiceSettlements = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.INVOICE_SETTLEMENTS,
        preset: BudgetV2PeriodPreset.LAST_30_DAYS,
        limit: 10,
      } as any,
      date('2026-09-10'),
    );

    expect(direct.items.map((item) => item.id)).not.toContain(
      'tx-expense-foreign',
    );
    expect(direct.total).toBe('61.00');
    expect(invoiceSettlements.items.map((item) => item.id)).toEqual([
      'settlement-invoice',
    ]);
    expect(invoiceSettlements.total).toBe('70.00');
  });

  it('paginates same-date homogeneous transactions without skips or duplicates', async () => {
    const service = new BudgetV2DrilldownService(createPrisma());
    const pages = [] as Awaited<
      ReturnType<BudgetV2DrilldownService['getDrilldown']>
    >[];
    let cursor: string | undefined;
    do {
      const page = await service.getDrilldown(
        'user-a',
        {
          bucket: BudgetV2Bucket.DIRECT_EXPENSES,
          preset: BudgetV2PeriodPreset.LAST_30_DAYS,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        } as any,
        date('2026-09-10'),
      );
      pages.push(page);
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (pages.at(-1)!.pageInfo.hasMore);

    expect(pages.map((page) => page.items.map((item) => item.id))).toEqual([
      ['tx-expense'],
      ['tx-expense-same-date'],
    ]);
    expect(pages.map((page) => page.pageInfo.hasMore)).toEqual([true, false]);
    expect(pages.at(-1)!.pageInfo.nextCursor).toBeNull();
    expect(pages.map((page) => page.total)).toEqual(['61.00', '61.00']);
    expect(
      new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size,
    ).toBe(2);
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
    const fourth = await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.OVERDUE_OUTFLOWS,
        limit: 1,
        cursor: third.pageInfo.nextCursor!,
      } as any,
      date('2026-09-10'),
    );

    expect(first.items.map((item) => item.id)).toEqual([
      'invoice-overdue-open',
    ]);
    expect(second.items.map((item) => item.id)).toEqual(['debt-overdue']);
    expect(third.items.map((item) => item.id)).toEqual([
      'debt-overdue-same-date',
    ]);
    expect(fourth.items.map((item) => item.id)).toEqual([
      'invoice-overdue-closed',
    ]);
    expect(first.total).toBe('495.00');
    expect(second.total).toBe('495.00');
    expect(third.total).toBe('495.00');
    expect(fourth.total).toBe('495.00');
    expect(fourth.pageInfo.nextCursor).toBeNull();
  });

  it('reconciles every bucket while traversing one-item pages', async () => {
    const prisma = createPrisma();
    const summary = await new BudgetV2Service(prisma).getBudget(
      'user-a',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      date('2026-09-10'),
    );
    const service = new BudgetV2DrilldownService(prisma);
    const realized = new Set([
      BudgetV2Bucket.MANUAL_INCOME,
      BudgetV2Bucket.RECEIVABLE_RECEIPTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW,
      BudgetV2Bucket.DIRECT_EXPENSES,
      BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
      BudgetV2Bucket.INVOICE_SETTLEMENTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
    ]);
    const buckets = Object.values(BudgetV2Bucket);
    for (const bucket of buckets) {
      const items: string[] = [];
      let cursor: string | undefined;
      let response;
      do {
        response = await service.getDrilldown(
          'user-a',
          {
            bucket,
            limit: 1,
            ...(realized.has(bucket)
              ? { preset: BudgetV2PeriodPreset.LAST_30_DAYS }
              : {}),
            ...(cursor ? { cursor } : {}),
          } as any,
          date('2026-09-10'),
        );
        items.push(...response.items.map((item) => item.id));
        cursor = response.pageInfo.nextCursor ?? undefined;
      } while (response.pageInfo.hasMore);

      expect(new Set(items).size, bucket).toBe(items.length);
      expect(response.total, bucket).toBe(
        bucket === BudgetV2Bucket.MANUAL_INCOME
          ? summary.composition.realized.manualIncome
          : bucket === BudgetV2Bucket.RECEIVABLE_RECEIPTS
            ? summary.composition.realized.receivableReceipts
            : bucket === BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW
              ? summary.composition.realized.personSettlementInflows
              : bucket === BudgetV2Bucket.DIRECT_EXPENSES
                ? summary.composition.realized.manualDirectTransactions
                : bucket === BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS
                  ? summary.composition.realized.debtDirectSettlements
                  : bucket === BudgetV2Bucket.INVOICE_SETTLEMENTS
                    ? summary.composition.realized.invoiceSettlements
                    : bucket === BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW
                      ? summary.composition.realized
                          .personSettlementDirectOutflows
                      : bucket === BudgetV2Bucket.UPCOMING_RECEIVABLES
                        ? summary.composition.upcoming.receivables
                        : bucket === BudgetV2Bucket.UPCOMING_INVOICES
                          ? summary.composition.upcoming.invoices
                          : bucket === BudgetV2Bucket.UPCOMING_DEBTS
                            ? summary.composition.upcoming.debts
                            : bucket === BudgetV2Bucket.OVERDUE_RECEIVABLES
                              ? summary.pending.overdue.inflow
                              : summary.pending.overdue.outflow,
      );
    }
  });

  it('uses bounded page queries and scoped aggregates for every bucket', async () => {
    const prisma = createPrisma();
    const service = new BudgetV2DrilldownService(prisma);
    const realized = new Set([
      BudgetV2Bucket.MANUAL_INCOME,
      BudgetV2Bucket.RECEIVABLE_RECEIPTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW,
      BudgetV2Bucket.DIRECT_EXPENSES,
      BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
      BudgetV2Bucket.INVOICE_SETTLEMENTS,
      BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
    ]);

    for (const bucket of Object.values(BudgetV2Bucket)) {
      await service.getDrilldown(
        'user-a',
        {
          bucket,
          limit: 1,
          ...(realized.has(bucket)
            ? { preset: BudgetV2PeriodPreset.LAST_30_DAYS }
            : {}),
        } as any,
        date('2026-09-10'),
      );
    }

    for (const modelName of [
      'transaction',
      'personSettlementGroup',
      'invoiceSettlement',
      'receivable',
      'debt',
      'invoice',
    ] as const) {
      const model = prisma[modelName];
      for (const call of model.findMany.mock.calls) {
        expect(call[0].take).toBe(2);
        expect(call[0].orderBy).toBeDefined();
        expect(call[0].where).toBeDefined();
      }
      expect(model.aggregate).toHaveBeenCalled();
    }
  });

  it('keeps ALL_TIME realized pages database-bounded', async () => {
    const prisma = createPrisma();
    const service = new BudgetV2DrilldownService(prisma);

    await service.getDrilldown(
      'user-a',
      {
        bucket: BudgetV2Bucket.DIRECT_EXPENSES,
        preset: BudgetV2PeriodPreset.ALL_TIME,
        limit: 1,
      } as any,
      date('2026-09-10'),
    );

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.transaction.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        userId: 'user-a',
        date: { lt: expect.any(Date) },
      }),
    );
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
