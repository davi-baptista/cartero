import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';

interface DueItem {
  label: string;
  dueDate: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private ensureVapid() {
    if (this.vapidConfigured) return;

    webpush.setVapidDetails(
      this.configService.get<string>('VAPID_SUBJECT') as string,
      this.configService.get<string>('VAPID_PUBLIC_KEY') as string,
      this.configService.get<string>('VAPID_PRIVATE_KEY') as string,
    );
    this.vapidConfigured = true;
  }

  async subscribe(userId: string, dto: SubscribeDto) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: {
        userId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
    });

    return { subscribed: true };
  }

  async unsubscribe(userId: string, dto: UnsubscribeDto) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: dto.endpoint },
    });

    return { subscribed: false };
  }

  /**
   * Chamado diariamente por um cron externo. Para cada usuário com
   * inscrições ativas, verifica o que vence dentro da janela configurada
   * (notifyDaysBefore) e envia uma única notificação resumida por usuário —
   * evita disparar uma notificação por item quando há vários vencendo juntos.
   */
  async runDueDateCheck() {
    this.ensureVapid();

    const users = await this.prisma.user.findMany({
      where: { pushSubscriptions: { some: {} } },
      include: { pushSubscriptions: true },
    });

    let sent = 0;
    for (const user of users) {
      const items = await this.findUpcomingItems(user.id, user.notifyDaysBefore);
      if (items.length === 0) continue;

      const payload = this.buildNotificationPayload(items);

      for (const subscription of user.pushSubscriptions) {
        const ok = await this.sendPush(subscription, payload);
        if (ok) sent++;
      }
    }

    this.logger.log(`Notificações de vencimento enviadas: ${sent}`);
    return { sent };
  }

  private async findUpcomingItems(
    userId: string,
    daysBefore: number,
  ): Promise<DueItem[]> {
    const now = new Date();
    // "Vence hoje ou nos próximos N dias" compara por dia, não pela hora exata —
    // senão uma dívida vencendo hoje de manhã já cairia fora do filtro à tarde.
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const windowEnd = new Date(
      todayStart.getTime() + (daysBefore + 1) * 24 * 60 * 60 * 1000,
    );

    const [debts, receivables, invoices] = await Promise.all([
      this.prisma.debt.findMany({
        where: {
          userId,
          isPaid: false,
          /*
            `isAlertEnabled` é a escolha explícita do usuário.

            O campo existe no schema, é gravável pelos dois DTOs, aparece como
            um switch rotulado "Exibir alerta no dia do vencimento" e a linha
            da dívida mostra um sino cortado quando está desligado — mas
            nenhum leitor o consultava. Desligar o alerta não desligava nada:
            o e-mail continuava saindo, e a interface afirmava o contrário.
          */
          isAlertEnabled: true,
          dueDate: { gte: todayStart, lt: windowEnd },
        },
      }),
      this.prisma.receivable.findMany({
        where: {
          userId,
          isPaid: false,
          dueDate: { gte: todayStart, lt: windowEnd },
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          userId,
          status: { in: ['OPEN', 'CLOSED'] },
          totalAmount: { gt: 0 },
        },
        include: { bank: true },
      }),
    ]);

    const items: DueItem[] = [
      ...debts.map((debt) => ({ label: debt.title, dueDate: debt.dueDate })),
      ...receivables.map((receivable) => ({
        label: receivable.title,
        dueDate: receivable.dueDate,
      })),
    ];

    for (const invoice of invoices) {
      // Vencimento persistido. Recalcular pela configuração do banco fazia o
      // alerta apontar para um dia diferente do que a fatura exibe, se o
      // cartão tivesse sido reconfigurado — o banco aqui serve só pelo nome.
      const dueDate = invoice.dueDate;
      if (dueDate >= todayStart && dueDate < windowEnd) {
        items.push({ label: `Fatura ${invoice.bank.name}`, dueDate });
      }
    }

    return items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  private buildNotificationPayload(items: DueItem[]) {
    const title =
      items.length === 1
        ? '1 item vencendo em breve'
        : `${items.length} itens vencendo em breve`;

    const body = items
      .slice(0, 5)
      .map((item) => `• ${item.label}`)
      .join('\n');

    return {
      title,
      body,
      url: '/overview',
    };
  }

  private async sendPush(
    subscription: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: { title: string; body: string; url: string },
  ): Promise<boolean> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      return true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Inscrição expirada ou revogada pelo navegador — remove.
        await this.prisma.pushSubscription.delete({
          where: { id: subscription.id },
        });
      } else {
        this.logger.warn(`Falha ao enviar push: ${String(error)}`);
      }
      return false;
    }
  }
}
