import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppScheduler.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.syncInvoiceStatus();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncInvoiceStatus() {
    this.logger.log('Verificando status de faturas...');

    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['OPEN', 'CLOSED'] } },
      include: { bank: true },
    });

    const now = new Date();

    for (const invoice of invoices) {
      const closeDate = new Date(
        invoice.year,
        invoice.month - 1,
        invoice.bank.invoiceCloseDate,
      );
      const dueDate = new Date(
        invoice.year,
        invoice.month - 1,
        invoice.bank.invoiceDueDate,
      );

      if (invoice.status === 'OPEN' && now >= closeDate) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'CLOSED' },
        });
      }

      if (invoice.status === 'CLOSED' && now >= dueDate) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OVERDUE' },
        });
      }
    }
  }
}
