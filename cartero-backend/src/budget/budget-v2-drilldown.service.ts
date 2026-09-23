import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  deriveBudgetV2PeriodBounds,
  shiftCivilDate,
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
import type { BudgetV2PeriodPreset } from './budget-v2.types';
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
      person: { select: { name: true } },
    },
  },
  paymentReceivable: {
    select: {
      id: true,
      userId: true,
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
  person: { select: { name: true } },
  bank: { select: { name: true } },
} as const;

const invoiceSettlementSelect = {
  id: true,
  invoiceId: true,
  amount: true,
  paidAt: true,
  invoice: {
    select: {
      dueDate: true,
      month: true,
      year: true,
      bank: { select: { name: true } },
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
  bank: { select: { name: true } },
} as const;

function serializeMoney(value: Prisma.Decimal | null | undefined): string {
  return (value ?? ZERO).toFixed(2);
}

function iso(value: Date): string {
  return value.toISOString();
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(
  encoded: string,
  expected: Omit<CursorPayload, 'date' | 'kind' | 'id'>,
): CursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
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
  constructor(private readonly prisma: PrismaService) {}

  async getDrilldown(
    userId: string,
    dto: GetBudgetV2DrilldownDto,
    now = new Date(),
  ): Promise<BudgetV2DrilldownResponse> {
    const bucket = dto.bucket;
    const realized = isRealizedBucket(bucket);

    if (realized && !dto.preset) {
      throw new BadRequestException(
        'preset is required for realized budget drilldown buckets',
      );
    }
    if (!realized && dto.preset) {
      throw new BadRequestException(
        'preset is forbidden for pending budget drilldown buckets',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const today = financialCivilDay(now, user.timeZone);
    const horizonExclusive = shiftCivilDate(today, 31);
    const periodBounds = realized
      ? deriveBudgetV2PeriodBounds(dto.preset!, user.timeZone, { now })
      : null;
    const scope = realized
      ? `${periodBounds!.period.startDate ?? ''}|${periodBounds!.period.endDate}`
      : `${today}|${horizonExclusive}`;
    const cursorScope = {
      version: 1 as const,
      bucket,
      preset: dto.preset ?? null,
      timeZone: user.timeZone,
      scope,
    };
    const cursor = dto.cursor ? decodeCursor(dto.cursor, cursorScope) : null;

    const result = await this.loadPageAndTotal(
      userId,
      bucket,
      periodBounds,
      today,
      horizonExclusive,
      cursor,
      dto.limit,
    );
    const items = result.rows.slice(0, dto.limit);
    const hasMore = result.rows.length > dto.limit;
    const last = items[items.length - 1];

    return {
      bucket,
      total: serializeMoney(result.total),
      context: {
        timeZone: user.timeZone,
        ...(periodBounds
          ? { period: periodBounds.period }
          : {
              pendingWindow: {
                startDate: today,
                endDateExclusive: horizonExclusive,
              },
            }),
      },
      items: items.map((row) => row.item),
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              ...cursorScope,
              date: last.date,
              kind: last.kind,
              id: last.id,
            })
          : null,
      },
    };
  }

  private async loadPageAndTotal(
    userId: string,
    bucket: BudgetV2Bucket,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds> | null,
    today: string,
    horizonExclusive: string,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
    if (bucket === BudgetV2Bucket.OVERDUE_OUTFLOWS) {
      return this.loadOverdueOutflows(userId, today, cursor, limit);
    }

    const date = periodBounds
      ? periodBounds.startInclusive
        ? { gte: periodBounds.startInclusive, lt: periodBounds.endExclusive }
        : { lt: periodBounds.endExclusive }
      : bucket === BudgetV2Bucket.UPCOMING_RECEIVABLES ||
          bucket === BudgetV2Bucket.UPCOMING_DEBTS ||
          bucket === BudgetV2Bucket.UPCOMING_INVOICES
        ? {
            gte: new Date(`${today}T00:00:00.000Z`),
            lt: new Date(`${horizonExclusive}T00:00:00.000Z`),
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
      case BudgetV2Bucket.UPCOMING_RECEIVABLES:
      case BudgetV2Bucket.OVERDUE_RECEIVABLES:
        return this.loadReceivablePageAndTotal(userId, date, cursor, limit);
      case BudgetV2Bucket.UPCOMING_DEBTS:
        return this.loadDebtPageAndTotal(userId, date, cursor, limit);
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
            personName: group.person.name,
            direction: group.direction as 'INFLOW' | 'OUTFLOW',
            paymentType: group.paymentType,
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
            amount: serializeMoney(settlement.amount),
            eventDate,
            dueDate: iso(settlement.invoice.dueDate),
            month: settlement.invoice.month,
            year: settlement.invoice.year,
            bankName: settlement.invoice.bank.name,
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
  ): Promise<PageResult> {
    const where = receivableBucketWhere(userId, dueDate);
    const pageWhere = withContinuation(where, dueDateIdCursorWhere(cursor));
    const [receivables, aggregate] = await Promise.all([
      this.prisma.receivable.findMany({
        where: pageWhere,
        select: receivableSelect,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.receivable.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      rows: receivables.map((receivable) => ({
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
      })),
      total: aggregate._sum.amount ?? ZERO,
    };
  }

  private async loadDebtPageAndTotal(
    userId: string,
    dueDate: Prisma.DateTimeFilter,
    cursor: CursorPayload | null,
    limit: number,
  ): Promise<PageResult> {
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
