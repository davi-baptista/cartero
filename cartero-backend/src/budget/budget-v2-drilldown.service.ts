import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  buildCursorPage,
  decodeCursor as decodeOpaqueCursor,
} from 'src/common/pagination/cursor.helper';
import {
  deriveBudgetV2MonthBounds,
  deriveBudgetV2PeriodBounds,
} from 'src/common/helpers/financial-period.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import { BudgetV2Bucket } from './budget-v2-classification.helper';
import {
  debtBucketWhere,
  invoiceBucketWhere,
  invoiceSettlementWhere,
  receivableBucketWhere,
  settlementBucketWhere,
  transactionBucketWhere,
} from './budget-v2-predicates.helper';
import { BudgetV2PeriodPreset } from './budget-v2.types';
import { RecurringIncomeService } from 'src/recurring-income/recurring-income.service';
import { RecurringExpenseService } from 'src/recurring-expense/recurring-expense.service';
import type { GetBudgetV2DrilldownDto } from './dto/get-budget-v2-drilldown.dto';
import type {
  BudgetV2DrilldownItem,
  BudgetV2DrilldownResponse,
} from './budget-v2-drilldown.types';

const ZERO = new Prisma.Decimal(0);
const OVERDUE_KIND_RANK = { DEBT: 0, INVOICE: 1 } as const;

type CursorPayload = {
  version: 1;
  bucket: BudgetV2Bucket;
  preset: BudgetV2PeriodPreset | null;
  timeZone: string;
  scope: string;
  date: string;
  kind: string;
  id: string;
};

type SortableItem = {
  item: BudgetV2DrilldownItem;
  amount: Prisma.Decimal;
  date: string;
  kind: string;
  id: string;
};

type PageResult = {
  rows: SortableItem[];
  total: Prisma.Decimal;
};

const transactionSelect = {
  id: true,
  amount: true,
  date: true,
  type: true,
  title: true,
  description: true,
  bank: { select: { name: true } },
  category: { select: { name: true } },
  paymentDebt: {
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      creditorName: true,
      person: { select: { id: true, name: true } },
    },
  },
  paymentReceivable: {
    select: {
      id: true,
      userId: true,
      personId: true,
      incomeClassification: true,
      recurringIncomeRuleId: true,
      title: true,
      description: true,
      debtorName: true,
      person: { select: { name: true } },
    },
  },
} as const;

const settlementSelect = {
  id: true,
  netAmount: true,
  settledAt: true,
  direction: true,
  paymentType: true,
  settlementTransaction: { select: { id: true } },
  person: { select: { id: true, name: true } },
  bank: { select: { name: true } },
} as const;

const invoiceSettlementSelect = {
  id: true,
  invoiceId: true,
  transactionId: true,
  amount: true,
  paidAt: true,
  invoice: {
    select: {
      dueDate: true,
      month: true,
      year: true,
      bank: { select: { id: true, name: true, isSystem: true } },
    },
  },
} as const;

const receivableSelect = {
  id: true,
  amount: true,
  dueDate: true,
  title: true,
  description: true,
  debtorName: true,
  person: { select: { name: true } },
} as const;

const debtSelect = {
  id: true,
  amount: true,
  dueDate: true,
  title: true,
  description: true,
  creditorName: true,
  person: { select: { name: true } },
} as const;

const invoiceSelect = {
  id: true,
  totalAmount: true,
  dueDate: true,
  month: true,
  year: true,
  bank: { select: { id: true, name: true } },
} as const;

function serializeMoney(value: Prisma.Decimal | null | undefined): string {
  return (value ?? ZERO).toFixed(2);
}

function iso(value: Date): string {
  return value.toISOString();
}

function matchesDateFilter(
  value: Date,
  filter: Prisma.DateTimeFilter,
): boolean {
  const instant = value.getTime();
  if (filter.gte && instant < new Date(filter.gte).getTime()) return false;
  if (filter.gt && instant <= new Date(filter.gt).getTime()) return false;
  if (filter.lte && instant > new Date(filter.lte).getTime()) return false;
  if (filter.lt && instant >= new Date(filter.lt).getTime()) return false;
  if (filter.equals && instant !== new Date(filter.equals).getTime())
    return false;
  return true;
}

function decodeCursor(
  encoded: string,
  expected: Omit<CursorPayload, 'date' | 'kind' | 'id'>,
): CursorPayload {
  try {
    const parsed = decodeOpaqueCursor(
      encoded,
      (value): value is CursorPayload =>
        !!value && typeof value === 'object' && !Array.isArray(value),
      'Invalid budget drilldown cursor',
    ) as Partial<CursorPayload>;

    if (
      parsed.version !== 1 ||
      parsed.bucket !== expected.bucket ||
      parsed.preset !== expected.preset ||
      parsed.timeZone !== expected.timeZone ||
      parsed.scope !== expected.scope ||
      typeof parsed.date !== 'string' ||
      typeof parsed.kind !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('incompatible cursor');
    }

    if (
      expected.bucket === BudgetV2Bucket.OVERDUE_OUTFLOWS &&
      !(parsed.kind in OVERDUE_KIND_RANK)
    ) {
      throw new Error('incompatible overdue cursor');
    }

    return parsed as CursorPayload;
  } catch {
    throw new BadRequestException('Invalid budget drilldown cursor');
  }
}

function isRealizedBucket(bucket: BudgetV2Bucket): boolean {
  return [
    BudgetV2Bucket.MANUAL_INCOME,
    BudgetV2Bucket.RECEIVABLE_RECEIPTS,
    BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW,
    BudgetV2Bucket.DIRECT_EXPENSES,
    BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS,
    BudgetV2Bucket.INVOICE_SETTLEMENTS,
    BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW,
  ].includes(bucket);
}

function isPendingBucket(bucket: BudgetV2Bucket): boolean {
  return [
    BudgetV2Bucket.UPCOMING_RECEIVABLES,
    BudgetV2Bucket.UPCOMING_INVOICES,
    BudgetV2Bucket.UPCOMING_DEBTS,
  ].includes(bucket);
}

function dateIdCursorWhere(
  cursor: CursorPayload | null,
  descending: boolean,
  field: 'date' | 'settledAt' | 'paidAt',
): Record<string, unknown> | null {
  if (!cursor) return null;
  const date = new Date(cursor.date);
  return {
    OR: descending
      ? [{ [field]: { lt: date } }, { [field]: date, id: { gt: cursor.id } }]
      : [{ [field]: { gt: date } }, { [field]: date, id: { gt: cursor.id } }],
  };
}

function dueDateIdCursorWhere(
  cursor: CursorPayload | null,
): Record<string, unknown> | null {
  if (!cursor) return null;
  const date = new Date(cursor.date);
  return {
    OR: [{ dueDate: { gt: date } }, { dueDate: date, id: { gt: cursor.id } }],
  };
}

function overdueStreamCursorWhere(
  cursor: CursorPayload | null,
  sourceKind: keyof typeof OVERDUE_KIND_RANK,
): Record<string, unknown> | null {
  if (!cursor) return null;

  const cursorRank =
    OVERDUE_KIND_RANK[cursor.kind as keyof typeof OVERDUE_KIND_RANK];
  const sourceRank = OVERDUE_KIND_RANK[sourceKind];
  const date = new Date(cursor.date);
  const sameDate =
    sourceRank > cursorRank
      ? { dueDate: date }
      : sourceRank === cursorRank
        ? { dueDate: date, id: { gt: cursor.id } }
        : null;

  return {
    OR: [{ dueDate: { gt: date } }, ...(sameDate ? [sameDate] : [])],
  };
}

function withContinuation<T>(
  base: T,
  continuation: Record<string, unknown> | null,
): T | { AND: [T, Record<string, unknown>] } {
  return continuation ? { AND: [base, continuation] } : base;
}

function compareOverdue(a: SortableItem, b: SortableItem): number {
  const dates = a.date.localeCompare(b.date);
  if (dates !== 0) return dates;
  const kinds =
    OVERDUE_KIND_RANK[a.kind as keyof typeof OVERDUE_KIND_RANK] -
    OVERDUE_KIND_RANK[b.kind as keyof typeof OVERDUE_KIND_RANK];
  if (kinds !== 0) return kinds;
  return a.id.localeCompare(b.id);
}

function assertNever(value: never): never {
  void value;
  throw new Error('Unsupported drilldown bucket');
}

@Injectable()
export class BudgetV2DrilldownService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly recurringIncomeService?: RecurringIncomeService,
    @Optional()
    private readonly recurringExpenseService?: RecurringExpenseService,
  ) {}

  async getDrilldown(
    userId: string,
    dto: GetBudgetV2DrilldownDto,
    now = new Date(),
  ): Promise<BudgetV2DrilldownResponse> {
    const bucket = dto.bucket;
    const realized = isRealizedBucket(bucket);
    const pendingPreset = dto.preset ?? BudgetV2PeriodPreset.THIS_MONTH;

    if (realized && !dto.preset) {
      throw new BadRequestException(
        'preset is required for realized budget drilldown buckets',
      );
    }
    if (!realized && !isPendingBucket(bucket) && dto.preset) {
      throw new BadRequestException(
        'preset is forbidden for pending budget drilldown buckets',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const today = financialCivilDay(now, user.timeZone);
    if ((dto.month === undefined) !== (dto.year === undefined)) {
      throw new BadRequestException('month and year must be provided together');
    }
    if (
      (realized || isPendingBucket(bucket)) &&
      pendingPreset === BudgetV2PeriodPreset.MONTH &&
      (dto.month === undefined || dto.year === undefined)
    ) {
      throw new BadRequestException('MONTH preset requires month and year');
    }
    const periodBounds =
      realized || isPendingBucket(bucket)
        ? dto.month !== undefined && dto.year !== undefined
          ? deriveBudgetV2MonthBounds(dto.month, dto.year, user.timeZone)
          : deriveBudgetV2PeriodBounds(
              realized ? dto.preset! : pendingPreset,
              user.timeZone,
              { now },
            )
        : null;
    const scope = periodBounds
      ? `${periodBounds.period.startDate ?? ''}|${periodBounds.period.endDate}`
      : `${today}|overdue`;
    const cursorScope = {
      version: 1 as const,
      bucket,
      preset: periodBounds ? periodBounds.period.preset : null,
      timeZone: user.timeZone,
      scope,
    };
    const cursor = dto.cursor ? decodeCursor(dto.cursor, cursorScope) : null;

    const result = await this.loadPageAndTotal(
      userId,
      bucket,
      periodBounds,
      today,
      cursor,
      dto.limit,
    );
    const page = buildCursorPage(result.rows, dto.limit, (last) => ({
      ...cursorScope,
      date: last.date,
      kind: last.kind,
      id: last.id,
    }));

    return {
      bucket,
      total: serializeMoney(result.total),
      context: {
        timeZone: user.timeZone,
        ...(periodBounds
          ? { period: periodBounds.period }
          : {
              pendingWindow: { startDate: today, endDateExclusive: today },
            }),
      },
      items: page.items.map((row) => row.item),
      pageInfo: page.pageInfo,
    };
  }

  private async loadPageAndTotal(
    userId: string,
    bucket: BudgetV2Bucket,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds> | null,
    today: string,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    if (bucket === BudgetV2Bucket.OVERDUE_OUTFLOWS) {
      return this.loadOverdueOutflows(userId, today, cursor, limit);
    }
    if (bucket === BudgetV2Bucket.OVERDUE_RECEIVABLES) {
      return this.loadReceivablePageAndTotal(
        userId,
        { lt: new Date(`${today}T00:00:00.000Z`) },
        cursor,
        limit,
        today.slice(0, 7),
      );
    }

    const date =
      periodBounds && isRealizedBucket(bucket)
        ? periodBounds.startInclusive
          ? { gte: periodBounds.startInclusive, lt: periodBounds.endExclusive }
          : { lt: periodBounds.endExclusive }
        : periodBounds
          ? periodBounds.period.startDate === null
            ? { gte: new Date(`${today}T00:00:00.000Z`) }
            : {
                gte: new Date(
                  `${periodBounds.period.startDate > today ? periodBounds.period.startDate : today}T00:00:00.000Z`,
                ),
                lt: new Date(`${periodBounds.period.endDate}T00:00:00.000Z`),
              }
          : { lt: new Date(`${today}T00:00:00.000Z`) };

    switch (bucket) {
      case BudgetV2Bucket.MANUAL_INCOME:
      case BudgetV2Bucket.RECEIVABLE_RECEIPTS:
      case BudgetV2Bucket.DIRECT_EXPENSES:
      case BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS:
        return this.loadTransactionPageAndTotal(
          userId,
          bucket,
          date,
          cursor,
          limit,
        );
      case BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW:
      case BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW:
        return this.loadSettlementPageAndTotal(
          userId,
          bucket,
          date,
          cursor,
          limit,
        );
      case BudgetV2Bucket.INVOICE_SETTLEMENTS:
        return this.loadInvoiceSettlementPageAndTotal(
          userId,
          date,
          cursor,
          limit,
        );
      case BudgetV2Bucket.UPCOMING_RECEIVABLES: {
        const projectionMonth =
          periodBounds?.period.startDate?.slice(0, 7) ?? today.slice(0, 7);
        return this.loadReceivablePageAndTotal(
          userId,
          date,
          cursor,
          limit,
          projectionMonth,
        );
      }
      case BudgetV2Bucket.UPCOMING_DEBTS:
        return this.loadDebtPageAndTotal(
          userId,
          date,
          cursor,
          limit,
          periodBounds?.period.startDate?.slice(0, 7) ?? today.slice(0, 7),
        );
      case BudgetV2Bucket.UPCOMING_INVOICES:
        return this.loadInvoicePageAndTotal(userId, date, cursor, limit);
      default:
        return assertNever(bucket);
    }
  }

  private async loadTransactionPageAndTotal(
    userId: string,
    bucket: BudgetV2Bucket,
    date: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    const where = transactionBucketWhere(bucket, userId, date);
    const pageWhere = withContinuation(
      where,
      dateIdCursorWhere(cursor, true, 'date'),
    );
    const [transactions, aggregate] = await Promise.all([
      this.prisma.transaction.findMany({
        where: pageWhere,
        select: transactionSelect,
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.transaction.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      rows: transactions.map((transaction) =>
        this.transactionRow(transaction, bucket),
      ),
      total: aggregate._sum.amount ?? ZERO,
    };
  }

  private transactionRow(
    transaction: Prisma.TransactionGetPayload<{
      select: typeof transactionSelect;
    }>,
    bucket: BudgetV2Bucket,
  ): SortableItem {
    const eventDate = iso(transaction.date);
    if (bucket === BudgetV2Bucket.RECEIVABLE_RECEIPTS) {
      const source = transaction.paymentReceivable!;
      return {
        amount: transaction.amount,
        date: eventDate,
        kind: 'RECEIVABLE_RECEIPT',
        id: transaction.id,
        item: {
          kind: 'RECEIVABLE_RECEIPT',
          id: transaction.id,
          sourceId: source.id,
          amount: serializeMoney(transaction.amount),
          eventDate,
          title: source.title,
          description: source.description,
          counterparty: source.person?.name ?? source.debtorName,
          personName: source.person?.name ?? null,
          bankName: transaction.bank.name,
          paymentType: transaction.type,
        },
      };
    }
    if (bucket === BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS) {
      const source = transaction.paymentDebt!;
      return {
        amount: transaction.amount,
        date: eventDate,
        kind: 'DEBT_SETTLEMENT',
        id: transaction.id,
        item: {
          kind: 'DEBT_SETTLEMENT',
          id: transaction.id,
          sourceId: source.id,
          amount: serializeMoney(transaction.amount),
          eventDate,
          title: source.title,
          description: source.description,
          counterparty: source.person?.name ?? source.creditorName,
          personName: source.person?.name ?? null,
          bankName: transaction.bank.name,
          paymentType: transaction.type,
        },
      };
    }
    return {
      amount: transaction.amount,
      date: eventDate,
      kind: 'TRANSACTION',
      id: transaction.id,
      item: {
        kind: 'TRANSACTION',
        id: transaction.id,
        amount: serializeMoney(transaction.amount),
        eventDate,
        title: transaction.title,
        description: transaction.description,
        categoryName: transaction.category.name,
        bankName: transaction.bank.name,
        paymentType: transaction.type,
      },
    };
  }

  private async loadSettlementPageAndTotal(
    userId: string,
    bucket: BudgetV2Bucket,
    settledAt: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    const where = settlementBucketWhere(bucket, userId, settledAt);
    const pageWhere = withContinuation(
      where,
      dateIdCursorWhere(cursor, true, 'settledAt'),
    );
    const [groups, aggregate] = await Promise.all([
      this.prisma.personSettlementGroup.findMany({
        where: pageWhere,
        select: settlementSelect,
        orderBy: [{ settledAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.personSettlementGroup.aggregate({
        where,
        _sum: { netAmount: true },
      }),
    ]);

    return {
      rows: groups.map((group) => {
        const eventDate = iso(group.settledAt);
        return {
          amount: group.netAmount,
          date: eventDate,
          kind: 'PERSON_SETTLEMENT',
          id: group.id,
          item: {
            kind: 'PERSON_SETTLEMENT',
            id: group.id,
            amount: serializeMoney(group.netAmount),
            eventDate,
            personId: group.person.id,
            personName: group.person.name,
            direction: group.direction as 'INFLOW' | 'OUTFLOW',
            paymentType: group.paymentType,
            settlementTransactionId: group.settlementTransaction?.id ?? null,
            bankName: group.bank?.name ?? null,
          },
        };
      }),
      total: aggregate._sum.netAmount ?? ZERO,
    };
  }

  private async loadInvoiceSettlementPageAndTotal(
    userId: string,
    paidAt: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    const where = invoiceSettlementWhere(userId, paidAt);
    const pageWhere = withContinuation(
      where,
      dateIdCursorWhere(cursor, true, 'paidAt'),
    );
    const [settlements, aggregate] = await Promise.all([
      this.prisma.invoiceSettlement.findMany({
        where: pageWhere,
        select: invoiceSettlementSelect,
        orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.invoiceSettlement.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      rows: settlements.map((settlement) => {
        const eventDate = iso(settlement.paidAt);
        return {
          amount: settlement.amount,
          date: eventDate,
          kind: 'INVOICE_SETTLEMENT',
          id: settlement.id,
          item: {
            kind: 'INVOICE_SETTLEMENT',
            id: settlement.id,
            sourceId: settlement.invoiceId,
            transactionId: settlement.transactionId,
            amount: serializeMoney(settlement.amount),
            eventDate,
            dueDate: iso(settlement.invoice.dueDate),
            month: settlement.invoice.month,
            year: settlement.invoice.year,
            bankName: settlement.invoice.bank.isSystem
              ? null
              : settlement.invoice.bank.name,
            bankId: settlement.invoice.bank.id,
          },
        };
      }),
      total: aggregate._sum.amount ?? ZERO,
    };
  }

  private async loadReceivablePageAndTotal(
    userId: string,
    dueDate: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
    projectionMonth?: string,
  ): Promise<PageResult> {
    if (projectionMonth && this.recurringIncomeService) {
      return this.prisma.$transaction(
        async (tx) => {
          const projections =
            await this.recurringIncomeService!.projectMissingOccurrencesForMonth(
              userId,
              projectionMonth,
              tx,
            );
          return this.readReceivablePageAndTotal(
            tx,
            userId,
            dueDate,
            cursor,
            limit,
            projections,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    }
    return this.readReceivablePageAndTotal(
      this.prisma,
      userId,
      dueDate,
      cursor,
      limit,
      [],
    );
  }

  private async readReceivablePageAndTotal(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    dueDate: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
    projections: Awaited<
      ReturnType<RecurringIncomeService['projectMissingOccurrencesForMonth']>
    >,
  ): Promise<PageResult> {
    const where = receivableBucketWhere(userId, dueDate);
    const pageWhere = withContinuation(where, dueDateIdCursorWhere(cursor));
    const [receivables, aggregate] = await Promise.all([
      db.receivable.findMany({
        where: pageWhere,
        select: receivableSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      db.receivable.aggregate({ where, _sum: { amount: true } }),
    ]);

    const rows: SortableItem[] = receivables.map((receivable) => ({
      amount: receivable.amount,
      date: iso(receivable.dueDate),
      kind: 'RECEIVABLE',
      id: receivable.id,
      item: {
        kind: 'RECEIVABLE',
        id: receivable.id,
        amount: serializeMoney(receivable.amount),
        dueDate: iso(receivable.dueDate),
        title: receivable.title,
        description: receivable.description,
        counterparty: receivable.person?.name ?? receivable.debtorName,
      },
    }));
    const matchingProjections = projections.filter((projection) =>
      matchesDateFilter(projection.dueDate, dueDate),
    );
    rows.push(
      ...matchingProjections
        .filter(
          (projection) =>
            !cursor ||
            projection.dueDate.toISOString() > cursor.date ||
            (projection.dueDate.toISOString() === cursor.date &&
              projection.recurringIncomeRuleId > cursor.id),
        )
        .map((projection) => ({
          amount: projection.amount,
          date: iso(projection.dueDate),
          kind: 'RECEIVABLE',
          id: projection.recurringIncomeRuleId,
          item: {
            kind: 'RECURRING_INCOME_PROJECTION' as const,
            id: projection.recurringIncomeRuleId,
            amount: serializeMoney(projection.amount),
            dueDate: iso(projection.dueDate),
            title: projection.title,
            counterparty: projection.counterpartyName ?? projection.title,
          },
        })),
    );
    rows.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );

    const projectedTotal = matchingProjections.reduce(
      (sum, projection) => sum.add(projection.amount),
      ZERO,
    );
    return {
      rows: rows.slice(0, limit + 1),
      total: (aggregate._sum.amount ?? ZERO).add(projectedTotal),
    };
  }

  private async loadDebtPageAndTotal(
    userId: string,
    dueDate: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
    projectionMonth?: string,
  ): Promise<PageResult> {
    if (projectionMonth && this.recurringExpenseService) {
      return this.prisma.$transaction(
        async (tx) => {
          const projections =
            await this.recurringExpenseService!.projectMissingOccurrencesForMonth(
              userId,
              projectionMonth,
              tx,
            );
          const where = debtBucketWhere(userId, dueDate);
          const [debts, aggregate] = await Promise.all([
            tx.debt.findMany({
              where: withContinuation(where, dueDateIdCursorWhere(cursor)),
              select: debtSelect,
              orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
              take: limit + 1,
            }),
            tx.debt.aggregate({ where, _sum: { amount: true } }),
          ]);
          const rows: SortableItem[] = debts.map((debt) => ({
            amount: debt.amount,
            date: iso(debt.dueDate),
            kind: 'DEBT',
            id: debt.id,
            item: {
              kind: 'DEBT',
              id: debt.id,
              amount: serializeMoney(debt.amount),
              dueDate: iso(debt.dueDate),
              title: debt.title,
              description: debt.description,
              counterparty: debt.person?.name ?? debt.creditorName,
            },
          }));
          const matching = projections.filter((projection) =>
            matchesDateFilter(projection.dueDate, dueDate),
          );
          rows.push(
            ...matching
              .filter(
                (projection) =>
                  !cursor ||
                  projection.dueDate.toISOString() > cursor.date ||
                  (projection.dueDate.toISOString() === cursor.date &&
                    projection.recurringExpenseRuleId > cursor.id),
              )
              .map((projection) => ({
                amount: projection.amount,
                date: iso(projection.dueDate),
                kind: 'DEBT' as const,
                id: projection.recurringExpenseRuleId,
                item: {
                  kind: 'RECURRING_EXPENSE_PROJECTION' as const,
                  id: projection.recurringExpenseRuleId,
                  amount: serializeMoney(projection.amount),
                  dueDate: iso(projection.dueDate),
                  title: projection.title,
                  counterparty: projection.title,
                },
              })),
          );
          rows.sort(
            (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
          );
          const projectedTotal = matching.reduce(
            (sum, projection) => sum.add(projection.amount),
            ZERO,
          );
          return {
            rows: rows.slice(0, limit + 1),
            total: (aggregate._sum.amount ?? ZERO).add(projectedTotal),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    }
    const where = debtBucketWhere(userId, dueDate);
    const pageWhere = withContinuation(where, dueDateIdCursorWhere(cursor));
    const [debts, aggregate] = await Promise.all([
      this.prisma.debt.findMany({
        where: pageWhere,
        select: debtSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.debt.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      rows: debts.map((debt) => ({
        amount: debt.amount,
        date: iso(debt.dueDate),
        kind: 'DEBT',
        id: debt.id,
        item: {
          kind: 'DEBT',
          id: debt.id,
          amount: serializeMoney(debt.amount),
          dueDate: iso(debt.dueDate),
          title: debt.title,
          description: debt.description,
          counterparty: debt.person?.name ?? debt.creditorName,
        },
      })),
      total: aggregate._sum.amount ?? ZERO,
    };
  }

  private async loadInvoicePageAndTotal(
    userId: string,
    dueDate: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    const where = invoiceBucketWhere(userId, dueDate);
    const pageWhere = withContinuation(where, dueDateIdCursorWhere(cursor));
    const [invoices, aggregate] = await Promise.all([
      this.prisma.invoice.findMany({
        where: pageWhere,
        select: invoiceSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
    ]);

    return {
      rows: invoices.map((invoice) => ({
        amount: invoice.totalAmount,
        date: iso(invoice.dueDate),
        kind: 'INVOICE',
        id: invoice.id,
        item: {
          kind: 'INVOICE',
          id: invoice.id,
          amount: serializeMoney(invoice.totalAmount),
          dueDate: iso(invoice.dueDate),
          month: invoice.month,
          year: invoice.year,
          bankName: invoice.bank.name,
          bankId: invoice.bank.id,
        },
      })),
      total: aggregate._sum.totalAmount ?? ZERO,
    };
  }

  private async loadOverdueOutflows(
    userId: string,
    today: string,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    const dueDate = { lt: new Date(`${today}T00:00:00.000Z`) };
    const invoiceWhere = invoiceBucketWhere(userId, dueDate);
    const debtWhere = debtBucketWhere(userId, dueDate);
    const [invoices, debts, invoiceAggregate, debtAggregate] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: withContinuation(
            invoiceWhere,
            overdueStreamCursorWhere(cursor, 'INVOICE'),
          ),
          select: invoiceSelect,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        }),
        this.prisma.debt.findMany({
          where: withContinuation(
            debtWhere,
            overdueStreamCursorWhere(cursor, 'DEBT'),
          ),
          select: debtSelect,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        }),
        this.prisma.invoice.aggregate({
          where: invoiceWhere,
          _sum: { totalAmount: true },
        }),
        this.prisma.debt.aggregate({
          where: debtWhere,
          _sum: { amount: true },
        }),
      ]);

    const invoiceRows = invoices.map((invoice) => ({
      amount: invoice.totalAmount,
      date: iso(invoice.dueDate),
      kind: 'INVOICE',
      id: invoice.id,
      item: {
        kind: 'INVOICE' as const,
        id: invoice.id,
        amount: serializeMoney(invoice.totalAmount),
        dueDate: iso(invoice.dueDate),
        month: invoice.month,
        year: invoice.year,
        bankName: invoice.bank.name,
        bankId: invoice.bank.id,
      },
    }));
    const debtRows = debts.map((debt) => ({
      amount: debt.amount,
      date: iso(debt.dueDate),
      kind: 'DEBT',
      id: debt.id,
      item: {
        kind: 'DEBT' as const,
        id: debt.id,
        amount: serializeMoney(debt.amount),
        dueDate: iso(debt.dueDate),
        title: debt.title,
        description: debt.description,
        counterparty: debt.person?.name ?? debt.creditorName,
      },
    }));

    return {
      rows: [...invoiceRows, ...debtRows].sort(compareOverdue),
      total: (invoiceAggregate._sum.totalAmount ?? ZERO).add(
        debtAggregate._sum.amount ?? ZERO,
      ),
    };
  }
}
