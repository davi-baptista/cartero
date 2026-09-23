import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { deriveBudgetV2PeriodBounds } from 'src/common/helpers/financial-period.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import {
  BudgetV2PeriodPreset,
  type BudgetV2Period,
  type BudgetV2RealizedComposition,
  type BudgetV2ResponseContract,
} from './budget-v2.types';

const DIRECT_TRANSACTION_TYPES: TransactionType[] = [
  TransactionType.PIX,
  TransactionType.DEBIT_CARD,
  TransactionType.BOLETO,
];

const ZERO = new Prisma.Decimal(0);

function sumDecimal(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((sum, value) => sum.add(value), ZERO);
}

function serializeMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function shiftCivilDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function storedCivilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function classifyDueDate(
  dueDate: Date,
  today: string,
  horizonExclusive: string,
): 'overdue' | 'upcoming' | 'outside' {
  const dueDay = storedCivilDate(dueDate);
  if (dueDay < today) return 'overdue';
  if (dueDay < horizonExclusive) return 'upcoming';
  return 'outside';
}

@Injectable()
export class BudgetV2Service {
  constructor(private readonly prisma: PrismaService) {}

  async getPeriod(
    userId: string,
    preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.LAST_30_DAYS,
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
    preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.LAST_30_DAYS,
    now = new Date(),
  ): Promise<BudgetV2ResponseContract> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const bounds = deriveBudgetV2PeriodBounds(preset, user.timeZone, { now });
    const todayCivil = financialCivilDay(now, user.timeZone);
    const horizonExclusive = shiftCivilDate(todayCivil, 31);
    const date = bounds.startInclusive
      ? { gte: bounds.startInclusive, lt: bounds.endExclusive }
      : { lt: bounds.endExclusive };

    const [transactions, settlements, groups, receivables, debts, invoices] =
      await Promise.all([
        this.prisma.transaction.findMany({
          where: { userId, date },
          select: {
            type: true,
            amount: true,
            isRefund: true,
            paymentDebt: { select: { userId: true } },
            paymentReceivable: { select: { userId: true } },
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
        this.prisma.receivable.findMany({
          where: { userId, isPaid: false },
          select: { amount: true, dueDate: true },
        }),
        this.prisma.debt.findMany({
          where: { userId, isPaid: false },
          select: { amount: true, dueDate: true },
        }),
        this.prisma.invoice.findMany({
          where: {
            userId,
            status: { in: ['OPEN', 'CLOSED', 'OVERDUE'] },
          },
          select: { totalAmount: true, status: true, dueDate: true },
        }),
      ]);

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
      if (transaction.isRefund) continue;

      if (transaction.type === TransactionType.INCOME) {
        if (transaction.paymentReceivable?.userId === userId) {
          composition.receivableReceipts = composition.receivableReceipts.add(
            transaction.amount,
          );
        } else {
          composition.manualIncome = composition.manualIncome.add(
            transaction.amount,
          );
        }
        continue;
      }

      if (!DIRECT_TRANSACTION_TYPES.includes(transaction.type)) continue;
      if (transaction.paymentDebt?.userId === userId) {
        composition.debtDirectSettlements =
          composition.debtDirectSettlements.add(transaction.amount);
      } else {
        composition.manualDirectTransactions =
          composition.manualDirectTransactions.add(transaction.amount);
      }
    }

    composition.invoiceSettlements = sumDecimal(
      settlements.map((settlement) => settlement.amount),
    );

    for (const group of groups) {
      if (group.direction === 'INFLOW') {
        composition.personSettlementInflows =
          composition.personSettlementInflows.add(group.netAmount);
      } else if (
        group.direction === 'OUTFLOW' &&
        group.paymentType &&
        DIRECT_TRANSACTION_TYPES.includes(group.paymentType)
      ) {
        composition.personSettlementDirectOutflows =
          composition.personSettlementDirectOutflows.add(group.netAmount);
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

    const upcomingReceivables = sumDecimal(
      receivables
        .filter(
          (receivable) =>
            classifyDueDate(
              receivable.dueDate,
              todayCivil,
              horizonExclusive,
            ) === 'upcoming',
        )
        .map((receivable) => receivable.amount),
    );
    const overdueReceivables = sumDecimal(
      receivables
        .filter(
          (receivable) =>
            classifyDueDate(
              receivable.dueDate,
              todayCivil,
              horizonExclusive,
            ) === 'overdue',
        )
        .map((receivable) => receivable.amount),
    );
    const upcomingDebts = sumDecimal(
      debts
        .filter(
          (debt) =>
            classifyDueDate(debt.dueDate, todayCivil, horizonExclusive) ===
            'upcoming',
        )
        .map((debt) => debt.amount),
    );
    const overdueDebts = sumDecimal(
      debts
        .filter(
          (debt) =>
            classifyDueDate(debt.dueDate, todayCivil, horizonExclusive) ===
            'overdue',
        )
        .map((debt) => debt.amount),
    );
    const unresolvedInvoices = invoices.filter(
      (invoice) => invoice.status !== 'PAID',
    );
    const upcomingInvoices = sumDecimal(
      unresolvedInvoices
        .filter(
          (invoice) =>
            classifyDueDate(invoice.dueDate, todayCivil, horizonExclusive) ===
            'upcoming',
        )
        .map((invoice) => invoice.totalAmount),
    );
    const overdueInvoices = sumDecimal(
      unresolvedInvoices
        .filter(
          (invoice) =>
            classifyDueDate(invoice.dueDate, todayCivil, horizonExclusive) ===
            'overdue',
        )
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
