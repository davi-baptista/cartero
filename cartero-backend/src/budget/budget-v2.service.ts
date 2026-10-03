import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  deriveBudgetV2MonthBounds,
  deriveBudgetV2PeriodBounds,
} from 'src/common/helpers/financial-period.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import {
  BudgetV2PeriodPreset,
  type BudgetV2Period,
  type BudgetV2RealizedComposition,
  type BudgetV2ResponseContract,
} from './budget-v2.types';
import {
  BudgetV2Bucket,
  classifyBudgetV2PersonSettlement,
  classifyBudgetV2Transaction,
} from './budget-v2-classification.helper';
import { RecurringIncomeService } from 'src/recurring-income/recurring-income.service';
import { unresolvedDueDateWhere } from './budget-v2-predicates.helper';

const ZERO = new Prisma.Decimal(0);

function sumDecimal(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((sum, value) => sum.add(value), ZERO);
}

function serializeMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function dueCivilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isOverdue(value: Date, today: string): boolean {
  return dueCivilDate(value) < today;
}

function isPendingNormal(
  value: Date,
  period: BudgetV2Period,
  today: string,
): boolean {
  const due = dueCivilDate(value);
  return (
    due >= today &&
    (period.startDate === null ||
      (due >= period.startDate && due < period.endDate))
  );
}

@Injectable()
export class BudgetV2Service {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly recurringIncomeService?: RecurringIncomeService,
  ) {}

  async getPeriod(
    userId: string,
    preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.THIS_MONTH,
    now = new Date(),
  ): Promise<BudgetV2Period> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });

    return deriveBudgetV2PeriodBounds(preset, user.timeZone, { now }).period;
  }

  async getBudget(
    userId: string,
    preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.THIS_MONTH,
    now = new Date(),
    month?: number,
    year?: number,
  ): Promise<BudgetV2ResponseContract> {
    if (
      (month === undefined) !== (year === undefined) ||
      (preset === BudgetV2PeriodPreset.MONTH &&
        (month === undefined || year === undefined))
    ) {
      throw new BadRequestException('MONTH preset requires month and year');
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const bounds =
      month !== undefined && year !== undefined
        ? deriveBudgetV2MonthBounds(month, year, user.timeZone)
        : deriveBudgetV2PeriodBounds(preset, user.timeZone, { now });
    const todayCivil = financialCivilDay(now, user.timeZone);
    const date = bounds.startInclusive
      ? { gte: bounds.startInclusive, lt: bounds.endExclusive }
      : { lt: bounds.endExclusive };

    const [transactions, settlements, groups, debts, invoices] =
      await Promise.all([
        this.prisma.transaction.findMany({
          where: { userId, date, personSettlementGroupId: null },
          select: {
            type: true,
            amount: true,
            isRefund: true,
            paymentDebt: { select: { userId: true } },
            paymentReceivable: {
              select: {
                userId: true,
                personId: true,
                incomeClassification: true,
                recurringIncomeRuleId: true,
              },
            },
          },
        }),
        this.prisma.invoiceSettlement.findMany({
          where: { invoice: { userId }, paidAt: date },
          select: { amount: true },
        }),
        this.prisma.personSettlementGroup.findMany({
          where: { userId, status: 'ACTIVE', settledAt: date },
          select: { direction: true, paymentType: true, netAmount: true },
        }),
        this.prisma.debt.findMany({
          where: {
            ...unresolvedDueDateWhere(userId, bounds.period, todayCivil),
            isPaid: false,
          },
          select: { amount: true, dueDate: true },
        }),
        this.prisma.invoice.findMany({
          where: {
            ...unresolvedDueDateWhere(userId, bounds.period, todayCivil),
            status: { in: ['OPEN', 'CLOSED', 'OVERDUE'] },
          },
          select: { totalAmount: true, status: true, dueDate: true },
        }),
      ]);

    const receivableWhere = {
      ...unresolvedDueDateWhere(userId, bounds.period, todayCivil),
      isPaid: false,
    };
    let receivables: Array<{ amount: Prisma.Decimal; dueDate: Date }>;
    let projectedRecurringIncome: Array<{
      amount: Prisma.Decimal;
      dueDate: Date;
    }> = [];
    if (this.recurringIncomeService && bounds.period.startDate) {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const pending = await tx.receivable.findMany({
            where: receivableWhere,
            select: { amount: true, dueDate: true },
          });
          const projections =
            await this.recurringIncomeService!.projectMissingOccurrencesForMonth(
              userId,
              bounds.period.startDate!.slice(0, 7),
              tx,
            );
          return { pending, projections };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      receivables = result.pending;
      projectedRecurringIncome = result.projections;
    } else {
      receivables = await this.prisma.receivable.findMany({
        where: receivableWhere,
        select: { amount: true, dueDate: true },
      });
    }

    const composition: Record<
      keyof BudgetV2RealizedComposition,
      Prisma.Decimal
    > = {
      manualIncome: ZERO,
      receivableReceipts: ZERO,
      personSettlementInflows: ZERO,
      manualDirectTransactions: ZERO,
      debtDirectSettlements: ZERO,
      invoiceSettlements: ZERO,
      personSettlementDirectOutflows: ZERO,
    };

    for (const transaction of transactions) {
      switch (classifyBudgetV2Transaction(transaction, userId)) {
        case BudgetV2Bucket.MANUAL_INCOME:
          composition.manualIncome = composition.manualIncome.add(
            transaction.amount,
          );
          break;
        case BudgetV2Bucket.RECEIVABLE_RECEIPTS:
          composition.receivableReceipts = composition.receivableReceipts.add(
            transaction.amount,
          );
          break;
        case BudgetV2Bucket.DIRECT_EXPENSES:
          composition.manualDirectTransactions =
            composition.manualDirectTransactions.add(transaction.amount);
          break;
        case BudgetV2Bucket.DEBT_DIRECT_SETTLEMENTS:
          composition.debtDirectSettlements =
            composition.debtDirectSettlements.add(transaction.amount);
          break;
      }
    }

    composition.invoiceSettlements = sumDecimal(
      settlements.map((settlement) => settlement.amount),
    );

    for (const group of groups) {
      switch (classifyBudgetV2PersonSettlement(group)) {
        case BudgetV2Bucket.PERSON_SETTLEMENT_INFLOW:
          composition.personSettlementInflows =
            composition.personSettlementInflows.add(group.netAmount);
          break;
        case BudgetV2Bucket.PERSON_SETTLEMENT_DIRECT_OUTFLOW:
          composition.personSettlementDirectOutflows =
            composition.personSettlementDirectOutflows.add(group.netAmount);
          break;
      }
    }

    const inflow = sumDecimal([
      composition.manualIncome,
      composition.receivableReceipts,
      composition.personSettlementInflows,
    ]);
    const outflow = sumDecimal([
      composition.manualDirectTransactions,
      composition.debtDirectSettlements,
      composition.invoiceSettlements,
      composition.personSettlementDirectOutflows,
    ]);

    const upcomingReceivables = sumDecimal([
      ...receivables
        .filter((receivable) =>
          isPendingNormal(receivable.dueDate, bounds.period, todayCivil),
        )
        .map((receivable) => receivable.amount),
      ...projectedRecurringIncome
        .filter((receivable) =>
          isPendingNormal(receivable.dueDate, bounds.period, todayCivil),
        )
        .map((receivable) => receivable.amount),
    ]);
    const overdueReceivables = sumDecimal([
      ...receivables
        .filter((receivable) => isOverdue(receivable.dueDate, todayCivil))
        .map((receivable) => receivable.amount),
      ...projectedRecurringIncome
        .filter((receivable) => isOverdue(receivable.dueDate, todayCivil))
        .map((receivable) => receivable.amount),
    ]);
    const upcomingDebts = sumDecimal(
      debts
        .filter((debt) =>
          isPendingNormal(debt.dueDate, bounds.period, todayCivil),
        )
        .map((debt) => debt.amount),
    );
    const overdueDebts = sumDecimal(
      debts
        .filter((debt) => isOverdue(debt.dueDate, todayCivil))
        .map((debt) => debt.amount),
    );
    const upcomingInvoices = sumDecimal(
      invoices
        .filter((invoice) => invoice.status !== 'PAID')
        .filter((invoice) =>
          isPendingNormal(invoice.dueDate, bounds.period, todayCivil),
        )
        .map((invoice) => invoice.totalAmount),
    );
    const overdueInvoices = sumDecimal(
      invoices
        .filter((invoice) => invoice.status !== 'PAID')
        .filter((invoice) => isOverdue(invoice.dueDate, todayCivil))
        .map((invoice) => invoice.totalAmount),
    );
    const pendingInflow = upcomingReceivables.add(overdueReceivables);
    const pendingOutflow = upcomingInvoices
      .add(upcomingDebts)
      .add(overdueInvoices)
      .add(overdueDebts);
    const pendingNet = pendingInflow.sub(pendingOutflow);
    const realizedBalance = inflow.sub(outflow);

    return {
      period: bounds.period,
      realized: {
        inflow: serializeMoney(inflow),
        outflow: serializeMoney(outflow),
        balance: serializeMoney(realizedBalance),
      },
      pending: {
        inflow: serializeMoney(pendingInflow),
        outflow: serializeMoney(pendingOutflow),
        net: serializeMoney(pendingNet),
        overdue: {
          inflow: serializeMoney(overdueReceivables),
          outflow: serializeMoney(overdueDebts.add(overdueInvoices)),
        },
      },
      resultAfterPending: serializeMoney(realizedBalance.add(pendingNet)),
      composition: {
        realized: {
          manualIncome: serializeMoney(composition.manualIncome),
          receivableReceipts: serializeMoney(composition.receivableReceipts),
          personSettlementInflows: serializeMoney(
            composition.personSettlementInflows,
          ),
          manualDirectTransactions: serializeMoney(
            composition.manualDirectTransactions,
          ),
          debtDirectSettlements: serializeMoney(
            composition.debtDirectSettlements,
          ),
          invoiceSettlements: serializeMoney(composition.invoiceSettlements),
          personSettlementDirectOutflows: serializeMoney(
            composition.personSettlementDirectOutflows,
          ),
        },
        upcoming: {
          invoices: serializeMoney(upcomingInvoices),
          debts: serializeMoney(upcomingDebts),
          receivables: serializeMoney(upcomingReceivables),
        },
      },
    };
  }
}
