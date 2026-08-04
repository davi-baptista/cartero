import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import {
  getInvoiceCloseDateForPeriod,
  getInvoiceDueDateForPeriod,
} from './common/helpers/invoice.helper';

@Injectable()
export class AppScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppScheduler.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.syncInvoiceStatus();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    timeZone: 'America/Fortaleza',
  })
  async syncInvoiceStatus() {
    this.logger.log('Verificando status de faturas...');

    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['OPEN', 'CLOSED'] } },
      include: { bank: true },
    });

    const now = new Date();

    for (const invoice of invoices) {
      // Fortaleza is UTC-3. The helper also handles cycles that cross the
      // calendar boundary (close 30, due 6 => due in the following month).
      const closeDate = getInvoiceCloseDateForPeriod(
        invoice.bank,
        invoice.year,
        invoice.month,
      );
      const dueDate = getInvoiceDueDateForPeriod(
        invoice.bank,
        invoice.year,
        invoice.month,
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
