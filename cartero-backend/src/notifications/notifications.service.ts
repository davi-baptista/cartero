import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from 'src/prisma/prisma.service';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import { SubscribeDto } from './dto/subscribe.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';
import { SubscriptionStatusDto } from './dto/subscription-status.dto';

interface DueItem {
  id?: string;
  kind?: 'debt' | 'receivable' | 'invoice';
  label: string;
  dueDate: Date;
}

const DUE_DATE_NOTIFICATION = 'DUE_DATE_SUMMARY';
const CLAIM_LEASE_MS = 5 * 60 * 1000;

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

  /**
   * "Este device está registrado para receber notificações?"
   *
   * A pergunta é sobre UM endpoint, não sobre o usuário. O toggle do Perfil
   * fala do browser em que está sendo exibido, e um usuário com desktop,
   * celular e PWA tem várias inscrições simultâneas — `count > 0` responderia
   * "sim" num Brave que nunca se registrou, só porque o Chrome do desktop
   * está.
   *
   * Escopo `userId` + `endpoint`: um endpoint de outro usuário responde
   * `false`, nunca `true` nem erro — a resposta não distingue "não existe" de
   * "existe para outra pessoa", então não vaza a existência de inscrição
   * alheia.
   *
   * A resposta é só o booleano. Devolver a linha exporia `p256dh` e `auth`,
   * que são material criptográfico de entrega.
   */
  async getSubscriptionStatus(userId: string, dto: SubscriptionStatusDto) {
    const found = await this.prisma.pushSubscription.findFirst({
      where: { userId, endpoint: dto.endpoint },
      select: { id: true },
    });

    return { registered: found !== null };
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
      select: {
        id: true,
        notifyDaysBefore: true,
        timeZone: true,
        pushSubscriptions: true,
      },
    });
    const now = new Date();
    const usersById = new Map(users.map((user) => [user.id, user]));
    const candidates = await this.findUpcomingItemsBatch(users, now);
    let sent = 0;

    for (const [userId, items] of candidates) {
      const user = usersById.get(userId);
      if (!user) continue;
      const civilDay = this.currentCivilDay(now, user.timeZone);
      const occurrence = await this.prisma.notificationOccurrence.upsert({
        where: {
          userId_type_civilDay: {
            userId,
            type: DUE_DATE_NOTIFICATION,
            civilDay,
          },
        },
        create: { userId, type: DUE_DATE_NOTIFICATION, civilDay },
        update: {},
      });

      await this.prisma.notificationDelivery.createMany({
        data: user.pushSubscriptions.map((subscription) => ({
          occurrenceId: occurrence.id,
          pushSubscriptionId: subscription.id,
        })),
        skipDuplicates: true,
      });

      const payload = this.buildNotificationPayload(items);
      for (const subscription of user.pushSubscriptions) {
        const claimed = await this.claimDelivery(
          occurrence.id,
          subscription.id,
          now,
        );
        if (!claimed) continue;
        const result = await this.sendPush(subscription, payload);
        await this.finishDelivery(claimed.id, subscription.id, result);
        if (result === 'sent') sent++;
      }
    }

    this.logger.log(`Notificações de vencimento enviadas: ${sent}`);
    return { sent };
  }

  private currentCivilDay(now: Date, timeZone: string | null): string {
    if (timeZone !== null) return financialCivilDay(now, timeZone);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private async findUpcomingItemsBatch(
    users: Array<{
      id: string;
      notifyDaysBefore: number;
      timeZone: string | null;
    }>,
    now: Date,
  ): Promise<Map<string, DueItem[]>> {
    if (users.length === 0) return new Map();

    // Conservative superset for every account timezone; exact filtering stays
    // per user so no valid candidate is lost at a civil-day boundary.
    const queryStart = new Date(now.getTime() - 2 * 86400000);
    const maxDaysBefore = Math.max(
      ...users.map((user) => user.notifyDaysBefore),
    );
    const queryEnd = new Date(now.getTime() + (maxDaysBefore + 3) * 86400000);
    const userIds = users.map((user) => user.id);
    const [debts, receivables, invoices] = await Promise.all([
      this.prisma.debt.findMany({
        where: {
          userId: { in: userIds },
          isPaid: false,
          isAlertEnabled: true,
          dueDate: { gte: queryStart, lt: queryEnd },
        },
      }),
      this.prisma.receivable.findMany({
        where: {
          userId: { in: userIds },
          isPaid: false,
          dueDate: { gte: queryStart, lt: queryEnd },
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          userId: { in: userIds },
          status: { not: 'PAID' },
          totalAmount: { gt: 0 },
          dueDate: { gte: queryStart, lt: queryEnd },
        },
        include: { bank: true },
      }),
    ]);
    const result = new Map<string, DueItem[]>();
    const byUser = new Map(users.map((user) => [user.id, user]));
    const startFor = (user: { timeZone: string | null }) =>
      user.timeZone === null
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : this.utcDayStart(financialCivilDay(now, user.timeZone));
    const add = (userId: string, item: DueItem) => {
      const user = byUser.get(userId);
      if (!user) return;
      const start = startFor(user);
      const end = new Date(
        start.getTime() + (user.notifyDaysBefore + 1) * 86400000,
      );
      if (item.dueDate < start || item.dueDate >= end) return;
      const items = result.get(userId) ?? [];
      items.push(item);
      result.set(userId, items);
    };
    for (const debt of debts)
      add(debt.userId, {
        id: debt.id,
        kind: 'debt',
        label: debt.title,
        dueDate: debt.dueDate,
      });
    for (const receivable of receivables)
      add(receivable.userId, {
        id: receivable.id,
        kind: 'receivable',
        label: receivable.title,
        dueDate: receivable.dueDate,
      });
    for (const invoice of invoices)
      add(invoice.userId, {
        id: invoice.id,
        kind: 'invoice',
        label: `Fatura ${invoice.bank.name}`,
        dueDate: invoice.dueDate,
      });
    for (const items of result.values())
      items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return result;
  }

  private utcDayStart(day: string): Date {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date));
  }

  private async claimDelivery(
    occurrenceId: string,
    pushSubscriptionId: string,
    now: Date,
  ) {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        occurrenceId,
        pushSubscriptionId,
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED' },
          { status: 'SENDING', leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: 'SENDING',
        leaseUntil: new Date(now.getTime() + CLAIM_LEASE_MS),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (result.count !== 1) return null;
    return this.prisma.notificationDelivery.findUnique({
      where: {
        occurrenceId_pushSubscriptionId: { occurrenceId, pushSubscriptionId },
      },
      select: { id: true },
    });
  }

  private async finishDelivery(
    id: string,
    pushSubscriptionId: string,
    result: 'sent' | 'failed' | 'expired',
  ) {
    if (result === 'expired') {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: pushSubscriptionId },
      });
      return;
    }
    await this.prisma.notificationDelivery.update({
      where: { id },
      data:
        result === 'sent'
          ? { status: 'SENT', sentAt: new Date(), leaseUntil: null }
          : {
              status: 'FAILED',
              leaseUntil: null,
              lastError: 'web-push transient failure',
            },
    });
  }

  private async findUpcomingItems(
    userId: string,
    daysBefore: number,
    timeZone: string | null = null,
  ): Promise<DueItem[]> {
    const now = new Date();
    /*
      TZ5: "hoje", pela timezone financeira da conta.

      `timeZone === null` preserva EXATAMENTE o comportamento legado —
      `todayStart` continua construído pelos getters LOCAIS do processo
      (`getFullYear/getMonth/getDate`, sem `UTC`), nunca Fortaleza e nunca
      UTC puro. Esse sempre foi o "hoje" de Notifications, e não é reescrito
      para equivaler a nenhum outro domínio (§21) — mudar o legado não é o
      objetivo deste TZ5, só dar às contas com timezone configurada um
      caminho próprio, explícito.

      Para `timeZone != null`, o dia civil vem de `financialCivilDay` e é
      ancorado à MEIA-NOITE UTC daquele dia — meia-noite UTC sempre antecede
      o meio-dia UTC do MESMO dia civil (a âncora de `dueDate`,
      `parseDateOnly`), então a comparação por intervalo permanece correta.
    */
    const todayStart =
      timeZone === null
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : (() => {
            const [year, month, day] = financialCivilDay(now, timeZone)
              .split('-')
              .map(Number);
            return new Date(Date.UTC(year, month - 1, day));
          })();
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
    subscription: {
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    },
    payload: { title: string; body: string; url: string },
  ): Promise<'sent' | 'failed' | 'expired'> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      return 'sent';
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Inscrição expirada ou revogada pelo navegador — remove.
        return 'expired';
      } else {
        this.logger.warn(`Falha ao enviar push: ${String(error)}`);
      }
      return 'failed';
    }
  }
}
