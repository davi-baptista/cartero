import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  deriveBudgetV2PeriodBounds,
  shiftCivilDate,
} from 'src/common/helpers/financial-period.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import {
  BudgetV2Bucket,
  classifyBudgetV2Debt,
  classifyBudgetV2Invoice,
  classifyBudgetV2PersonSettlement,
  classifyBudgetV2Receivable,
  classifyBudgetV2Transaction,
} from './budget-v2-classification.helper';
import type { BudgetV2PeriodPreset } from './budget-v2.types';
import type { GetBudgetV2DrilldownDto } from './dto/get-budget-v2-drilldown.dto';
import type {
  BudgetV2DrilldownItem,
  BudgetV2DrilldownResponse,
} from './budget-v2-drilldown.types';

const ZERO = new Prisma.Decimal(0);

type SortableItem = {
  item: BudgetV2DrilldownItem;
  amount: Prisma.Decimal;
  date: string;
  kind: string;
  id: string;
};

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

const transactionSelect = {
  id: true,
  amount: true,
  date: true,
  type: true,
  isRefund: true,
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

function sumDecimal(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((sum, value) => sum.add(value), ZERO);
}

function serializeMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function iso(date: Date): string {
  return date.toISOString();
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

function isDescending(bucket: BudgetV2Bucket): boolean {
  return isRealizedBucket(bucket);
}

function compareSortable(
  a: SortableItem,
  b: SortableItem,
  descending: boolean,
): number {
  const dateOrder = a.date.localeCompare(b.date);
  if (dateOrder !== 0) return descending ? -dateOrder : dateOrder;

  const kindOrder = a.kind.localeCompare(b.kind);
  if (kindOrder !== 0) return kindOrder;
  return a.id.localeCompare(b.id);
}

function isAfterCursor(
  row: SortableItem,
  cursor: CursorPayload,
  descending: boolean,
): boolean {
  const dateOrder = row.date.localeCompare(cursor.date);
  if (dateOrder !== 0) return descending ? dateOrder < 0 : dateOrder > 0;

  const kindOrder = row.kind.localeCompare(cursor.kind);
  if (kindOrder !== 0) return kindOrder > 0;
  return row.id.localeCompare(cursor.id) > 0;
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
    const expectedCursorScope = {
      version: 1 as const,
      bucket,
      preset: dto.preset ?? null,
      timeZone: user.timeZone,
      scope,
    };
    const cursor = dto.cursor
      ? decodeCursor(dto.cursor, expectedCursorScope)
      : null;

    const rows = await this.loadRows(
      userId,
      bucket,
      periodBounds,
      today,
      horizonExclusive,
    );
    rows.sort((a, b) => compareSortable(a, b, isDescending(bucket)));

    const total = sumDecimal(rows.map((row) => row.amount));
    const afterCursor = cursor
      ? rows.filter((row) => isAfterCursor(row, cursor, isDescending(bucket)))
      : rows;
    const page = afterCursor.slice(0, dto.limit + 1);
    const hasMore = page.length > dto.limit;
    const items = page.slice(0, dto.limit);
    const last = items[items.length - 1];

    return {
      bucket,
      total: serializeMoney(total),
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
              ...expectedCursorScope,
              date: last.date,
              kind: last.kind,
              id: last.id,
            })
          : null,
      },
    };
  }

  private async loadRows(
    userId: string,
    bucket: BudgetV2Bucket,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds> | null,
    today: string,
    horizonExclusive: string,
  ): Promise<SortableItem[]> {
    switch (bucket) {
      case BudgetV2Bucket.MANUAL_INCOME:
      case BudgetV2Bucket.RECEIVABLE_RECEIPTS:
      case BudgetV2Bucket.DIRECT_EXPENSES:
      case BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS:
        return this.loadTransactionRows(userId, bucket, periodBounds!);
      case BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW:
      case BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW:
        return this.loadSettlementRows(userId, bucket, periodBounds!);
      case BudgetV2Bucket.INVOICE_SETTLEMENTS:
        return this.loadInvoiceSettlementRows(userId, periodBounds!);
      case BudgetV2Bucket.UPCOMING_RECEIVABLES:
      case BudgetV2Bucket.OVERDUE_RECEIVABLES:
        return this.loadReceivableRows(userId, bucket, today, horizonExclusive);
      case BudgetV2Bucket.UPCOMING_DEBTS:
        return this.loadDebtRows(userId, bucket, today, horizonExclusive);
      case BudgetV2Bucket.UPCOMING_INVOICES:
        return this.loadInvoiceRows(userId, bucket, today, horizonExclusive);
      case BudgetV2Bucket.OVERDUE_OUTFLOWS: {
        const [invoices, debts] = await Promise.all([
          this.loadInvoiceRows(userId, bucket, today, horizonExclusive),
          this.loadDebtRows(userId, bucket, today, horizonExclusive),
        ]);
        return [...invoices, ...debts];
      }
    }
  }

  private async loadTransactionRows(
    userId: string,
    bucket: BudgetV2Bucket,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds>,
  ): Promise<SortableItem[]> {
    const date = periodBounds.startInclusive
      ? { gte: periodBounds.startInclusive, lt: periodBounds.endExclusive }
      : { lt: periodBounds.endExclusive };
    const transactions = await this.prisma.transaction.findMany({
      where: { userId, date },
      select: transactionSelect,
    });

    return transactions.flatMap((transaction) => {
      if (classifyBudgetV2Transaction(transaction, userId) !== bucket) {
        return [];
      }

      const eventDate = iso(transaction.date);
      if (bucket === BudgetV2Bucket.RECEIVABLE_RECEIPTS) {
        if (!transaction.paymentReceivable) return [];
        return [
          {
            amount: transaction.amount,
            date: eventDate,
            kind: 'RECEIVABLE_RECEIPT',
            id: transaction.id,
            item: {
              kind: 'RECEIVABLE_RECEIPT',
              id: transaction.id,
              sourceId: transaction.paymentReceivable.id,
              amount: serializeMoney(transaction.amount),
              eventDate,
              title: transaction.paymentReceivable.title,
              description: transaction.paymentReceivable.description,
              counterparty:
                transaction.paymentReceivable.person?.name ??
                transaction.paymentReceivable.debtorName,
              bankName: transaction.bank.name,
              paymentType: transaction.type,
            },
          } as SortableItem,
        ];
      }

      if (bucket === BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS) {
        if (!transaction.paymentDebt) return [];
        return [
          {
            amount: transaction.amount,
            date: eventDate,
            kind: 'DEBT_SETTLEMENT',
            id: transaction.id,
            item: {
              kind: 'DEBT_SETTLEMENT',
              id: transaction.id,
              sourceId: transaction.paymentDebt.id,
              amount: serializeMoney(transaction.amount),
              eventDate,
              title: transaction.paymentDebt.title,
              description: transaction.paymentDebt.description,
              counterparty:
                transaction.paymentDebt.person?.name ??
                transaction.paymentDebt.creditorName,
              bankName: transaction.bank.name,
              paymentType: transaction.type,
            },
          } as SortableItem,
        ];
      }

      return [
        {
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
        } as SortableItem,
      ];
    });
  }

  private async loadSettlementRows(
    userId: string,
    bucket: BudgetV2Bucket,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds>,
  ): Promise<SortableItem[]> {
    const date = periodBounds.startInclusive
      ? { gte: periodBounds.startInclusive, lt: periodBounds.endExclusive }
      : { lt: periodBounds.endExclusive };
    const groups = await this.prisma.personSettlementGroup.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        settledAt: date,
      },
      select: {
        id: true,
        netAmount: true,
        settledAt: true,
        direction: true,
        paymentType: true,
        person: { select: { name: true } },
        bank: { select: { name: true } },
      },
    });

    return groups.flatMap((group) => {
      if (classifyBudgetV2PersonSettlement(group) !== bucket) return [];
      const eventDate = iso(group.settledAt);
      return [
        {
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
            direction: group.direction,
            paymentType: group.paymentType,
            bankName: group.bank?.name ?? null,
          },
        } as SortableItem,
      ];
    });
  }

  private async loadInvoiceSettlementRows(
    userId: string,
    periodBounds: ReturnType<typeof deriveBudgetV2PeriodBounds>,
  ): Promise<SortableItem[]> {
    const date = periodBounds.startInclusive
      ? { gte: periodBounds.startInclusive, lt: periodBounds.endExclusive }
      : { lt: periodBounds.endExclusive };
    const settlements = await this.prisma.invoiceSettlement.findMany({
      where: { invoice: { userId }, paidAt: date },
      select: {
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
      },
    });

    return settlements.map((settlement) => {
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
      } as SortableItem;
    });
  }

  private async loadReceivableRows(
    userId: string,
    bucket: BudgetV2Bucket,
    today: string,
    horizonExclusive: string,
  ): Promise<SortableItem[]> {
    const receivables = await this.prisma.receivable.findMany({
      where: { userId, isPaid: false },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        title: true,
        description: true,
        debtorName: true,
        isPaid: true,
        person: { select: { name: true } },
      },
    });

    return receivables.flatMap((receivable) => {
      if (
        classifyBudgetV2Receivable(
          receivable.isPaid,
          receivable.dueDate,
          today,
          horizonExclusive,
        ) !== bucket
      ) {
        return [];
      }
      const dueDate = iso(receivable.dueDate);
      return [
        {
          amount: receivable.amount,
          date: dueDate,
          kind: 'RECEIVABLE',
          id: receivable.id,
          item: {
            kind: 'RECEIVABLE',
            id: receivable.id,
            amount: serializeMoney(receivable.amount),
            dueDate,
            title: receivable.title,
            description: receivable.description,
            counterparty: receivable.person?.name ?? receivable.debtorName,
          },
        } as SortableItem,
      ];
    });
  }

  private async loadDebtRows(
    userId: string,
    bucket: BudgetV2Bucket,
    today: string,
    horizonExclusive: string,
  ): Promise<SortableItem[]> {
    const debts = await this.prisma.debt.findMany({
      where: { userId, isPaid: false },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        title: true,
        description: true,
        creditorName: true,
        isPaid: true,
        person: { select: { name: true } },
      },
    });

    return debts.flatMap((debt) => {
      if (
        classifyBudgetV2Debt(
          debt.isPaid,
          debt.dueDate,
          today,
          horizonExclusive,
        ) !== bucket
      ) {
        return [];
      }
      const dueDate = iso(debt.dueDate);
      return [
        {
          amount: debt.amount,
          date: dueDate,
          kind: 'DEBT',
          id: debt.id,
          item: {
            kind: 'DEBT',
            id: debt.id,
            amount: serializeMoney(debt.amount),
            dueDate,
            title: debt.title,
            description: debt.description,
            counterparty: debt.person?.name ?? debt.creditorName,
          },
        } as SortableItem,
      ];
    });
  }

  private async loadInvoiceRows(
    userId: string,
    bucket: BudgetV2Bucket,
    today: string,
    horizonExclusive: string,
  ): Promise<SortableItem[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        userId,
        status: { in: ['OPEN', 'CLOSED', 'OVERDUE'] },
      },
      select: {
        id: true,
        totalAmount: true,
        dueDate: true,
        month: true,
        year: true,
        status: true,
        bank: { select: { name: true } },
      },
    });

    return invoices.flatMap((invoice) => {
      if (
        classifyBudgetV2Invoice(
          invoice.status,
          invoice.dueDate,
          today,
          horizonExclusive,
        ) !== bucket
      ) {
        return [];
      }
      const dueDate = iso(invoice.dueDate);
      return [
        {
          amount: invoice.totalAmount,
          date: dueDate,
          kind: 'INVOICE',
          id: invoice.id,
          item: {
            kind: 'INVOICE',
            id: invoice.id,
            amount: serializeMoney(invoice.totalAmount),
            dueDate,
            month: invoice.month,
            year: invoice.year,
            bankName: invoice.bank.name,
          },
        } as SortableItem,
      ];
    });
  }
}
