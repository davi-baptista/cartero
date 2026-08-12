import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Formas de pagamento que saem do bolso na própria data da transação —
 * ao contrário do crédito, que só sai no vencimento da fatura.
 */
const DIRECT_PAYMENT_TYPES: TransactionType[] = [
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
];

@Injectable()
export class BudgetService {
  constructor(private prisma: PrismaService) {}

  async getBudget(userId: string, month: number, year: number) {
    // O mês/ano da fatura já representa o mês de vencimento, então o recorte
    // por competência de pagamento é o próprio período da invoice. Para os
    // demais lançamentos, o recorte é a data em que o dinheiro saiu.
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const [user, invoices, directPayments, debts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { salary: true },
      }),
      this.prisma.invoice.findMany({
        where: { userId, month, year },
        include: { bank: true },
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: { in: DIRECT_PAYMENT_TYPES },
          isRefund: false,
          date: { gte: monthStart, lt: monthEnd },
        },
        select: { amount: true },
      }),
      this.prisma.debt.findMany({
        where: {
          userId,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: { amount: true, isPaid: true },
      }),
    ]);

    const totalInvoices = invoices.reduce(
      (sum, inv) => sum + Number(inv.totalAmount),
      0,
    );

    const invoiceIds = invoices.map((inv) => inv.id);

    const reimbursableAgg =
      invoiceIds.length > 0
        ? await this.prisma.transaction.aggregate({
            where: {
              userId,
              invoiceId: { in: invoiceIds },
              personId: { not: null },
              type: 'CREDIT_CARD',
            },
            _sum: { amount: true },
          })
        : { _sum: { amount: null } };

    const totalReimbursable = Number(reimbursableAgg._sum.amount ?? 0);
    const netAmount = totalInvoices - totalReimbursable;

    const totalDirectPayments = directPayments.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );
    const totalDebts = debts.reduce((sum, debt) => sum + Number(debt.amount), 0);

    // Faturas e dívidas já quitadas continuam somando: o número representa o
    // custo real do mês, não só o que ainda falta desembolsar.
    const totalToPay = netAmount + totalDirectPayments + totalDebts;

    const paidInvoices = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const paidDebts = debts
      .filter((debt) => debt.isPaid)
      .reduce((sum, debt) => sum + Number(debt.amount), 0);
    const paidDebtsCount = debts.filter((debt) => debt.isPaid).length;

    // Pagamentos diretos já aconteceram por definição — a transação só existe
    // porque o dinheiro saiu.
    const totalPaid = paidInvoices + paidDebts + totalDirectPayments;

    return {
      month,
      year,
      salary: user?.salary != null ? Number(user.salary) : null,
      totalInvoices,
      totalReimbursable,
      netAmount,
      totalDirectPayments,
      totalDebts,
      debtsCount: debts.length,
      paidDebtsCount,
      totalToPay,
      totalPaid,
      totalPending: totalToPay - totalPaid,
      invoices,
    };
  }
}
