import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BudgetService {
  constructor(private prisma: PrismaService) {}

  async getBudget(userId: string, month: number, year: number) {
    const [user, invoices] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { salary: true },
      }),
      this.prisma.invoice.findMany({
        where: { userId, month, year },
        include: { bank: true },
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

    return {
      month,
      year,
      salary: user?.salary != null ? Number(user.salary) : null,
      totalInvoices,
      totalReimbursable,
      netAmount,
      invoices,
    };
  }
}
