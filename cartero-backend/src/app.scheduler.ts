import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { deriveStatusFromInvoiceDates } from './common/helpers/invoice.helper';

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

    // PAID é estado manual e final: o cron nunca o atribui nem o revoga.
    //
    // Sem `include: { bank: true }`: o status sai das datas que a própria
    // fatura guarda. Carregar o banco era o que permitia a uma reconfiguração
    // do cartão alterar o calendário de faturas históricas durante o cron —
    // um sync noturno reescrevia o passado sem ninguém pedir.
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['OPEN', 'CLOSED'] } },
      select: {
        id: true,
        status: true,
        closeDate: true,
        dueDate: true,
      },
    });

    const now = new Date();

    for (const invoice of invoices) {
      // O status correto vem do calendário, em uma única decisão. Aplicar as
      // transições em sequência (OPEN→CLOSED, depois CLOSED→OVERDUE) fazia a
      // segunda condição ler o status carregado do banco, e não o recém
      // gravado: uma fatura ainda OPEN cujo vencimento já passou avançava só
      // até CLOSED, e só ficaria OVERDUE na execução do dia seguinte. Isso
      // aparecia sempre que o scheduler ficava alguns dias indisponível.
      const status = deriveStatusFromInvoiceDates(invoice, now);

      if (status !== invoice.status) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status },
        });
      }
    }
  }
}
