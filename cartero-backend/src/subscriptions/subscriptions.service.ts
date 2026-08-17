import { Injectable, NotFoundException } from '@nestjs/common';
import { Bank, Subscription, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import {
  findOrCreateInvoice,
  getInvoicePeriodForDate,
} from 'src/common/helpers/invoice.helper';
import {
  chargeDateForCycle,
  formatCycle,
  pendingCycles,
} from 'src/common/helpers/subscription.helper';
import {
  SUBSCRIPTION_CATEGORY_COLOR,
  SUBSCRIPTION_CATEGORY_NAME,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

/** O que uma geração produziu — usado no preview e no resultado do run. */
export interface GenerationPlanItem {
  cycle: string;
  date: Date;
  /** Faturas já pagas são puladas: o usuário já conciliou aquele mês na mão. */
  skipped: boolean;
  skipReason?: 'invoice-paid';
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private entityValidation: EntityValidationService,
  ) {}

  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: { bank: true, category: true },
      orderBy: [{ isActive: 'desc' }, { dayOfMonth: 'asc' }],
    });
  }

  async findOne(id: string, userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, userId },
      include: { bank: true, category: true },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    return subscription;
  }

  async create(userId: string, dto: CreateSubscriptionDto) {
    await this.entityValidation.validateBank(dto.bankId, userId);

    // Assinatura tem categoria própria e fixa — o usuário não escolhe, e os
    // lançamentos gerados ficam identificáveis no extrato.
    const category = await this.entityValidation.findOrCreateSystemCategory(
      this.prisma,
      userId,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        bankId: dto.bankId,
        categoryId: category.id,
        title: dto.title,
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        dayOfMonth: dto.dayOfMonth,
        startedAt: dto.startedAt,
      },
    });

    // Um `startedAt` retroativo traz o histórico junto; o corrente só gera
    // quando o dia da cobrança chega.
    const generated = await this.runForSubscription(subscription);

    return { ...(await this.findOne(subscription.id, userId)), generated };
  }

  async update(id: string, userId: string, dto: UpdateSubscriptionDto) {
    await this.findOne(id, userId);
    if (dto.bankId)
      await this.entityValidation.validateBank(dto.bankId, userId);

    // Campo a campo de propósito: `startedAt`, `lastGeneratedFor` e
    // `categoryId` não podem ser alterados por payload, e o ValidationPipe
    // global não usa whitelist — um spread deixaria passar o que viesse no
    // corpo da requisição.
    await this.prisma.subscription.update({
      where: { id },
      data: {
        title: dto.title,
        bankId: dto.bankId,
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        dayOfMonth: dto.dayOfMonth,
        isActive: dto.isActive,
        updatedAt: new Date(),
      },
    });

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    // Os lançamentos já criados permanecem — o FK é ON DELETE SET NULL, então
    // eles apenas deixam de apontar para a regra.
    await this.prisma.subscription.delete({ where: { id } });
    return { id };
  }

  /**
   * Simula a geração sem escrever nada. Alimenta o aviso mostrado antes de
   * criar uma assinatura com início retroativo.
   */
  async previewFor(
    userId: string,
    bankId: string,
    dayOfMonth: number,
    startedAt: string,
    type: TransactionType,
    now: Date = new Date(),
  ): Promise<GenerationPlanItem[]> {
    const cycles = pendingCycles(startedAt, null, dayOfMonth, now);
    if (cycles.length === 0) return [];

    const bank = await this.entityValidation.validateBank(bankId, userId);
    const plan: GenerationPlanItem[] = [];

    for (const cycle of cycles) {
      const date = chargeDateForCycle(cycle, dayOfMonth);
      const paid =
        type === TransactionType.CREDIT_CARD &&
        (await this.isInvoicePaid(userId, bank, date));
      plan.push({
        cycle: formatCycle(cycle),
        date,
        skipped: paid,
        skipReason: paid ? 'invoice-paid' : undefined,
      });
    }

    return plan;
  }

  /** Gera os ciclos pendentes de todas as assinaturas ativas do usuário. */
  async runForUser(userId: string, now: Date = new Date()) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId, isActive: true },
    });

    const results: Array<{
      subscriptionId: string;
      generated: GenerationPlanItem[];
    }> = [];
    for (const subscription of subscriptions) {
      const generated = await this.runForSubscription(subscription, now);
      if (generated.length > 0) {
        results.push({ subscriptionId: subscription.id, generated });
      }
    }
    return results;
  }

  /** Gera os pendentes de todos os usuários — usado pelo cron. */
  async runForAll(now: Date = new Date()) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { isActive: true },
    });

    let created = 0;
    for (const subscription of subscriptions) {
      const generated = await this.runForSubscription(subscription, now);
      created += generated.filter((item) => !item.skipped).length;
    }
    return { subscriptions: subscriptions.length, created };
  }

  /** A fatura vem da data da cobrança, não do ciclo — ver `runForSubscription`. */
  private async isInvoicePaid(
    userId: string,
    bank: Pick<Bank, 'id' | 'invoiceDueDate' | 'invoiceDueDaysAfterClose'>,
    chargeDate: Date,
  ): Promise<boolean> {
    const { year, month } = getInvoicePeriodForDate(
      {
        invoiceDueDate: bank.invoiceDueDate,
        invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
      },
      chargeDate,
    );
    const invoice = await this.prisma.invoice.findFirst({
      where: { userId, bankId: bank.id, year, month },
      select: { status: true },
    });
    return invoice?.status === 'PAID';
  }

  /**
   * Gera os ciclos que faltam para uma assinatura. Idempotente: o avanço de
   * `lastGeneratedFor` acontece na mesma transação do lançamento, então rodar
   * duas vezes no mesmo dia não duplica nada.
   */
  private async runForSubscription(
    subscription: Subscription,
    now: Date = new Date(),
  ): Promise<GenerationPlanItem[]> {
    const cycles = pendingCycles(
      subscription.startedAt,
      subscription.lastGeneratedFor,
      subscription.dayOfMonth,
      now,
    );
    if (cycles.length === 0) return [];

    const bank = await this.prisma.bank.findFirst({
      where: { id: subscription.bankId, userId: subscription.userId },
    });
    if (!bank) return [];

    const plan: GenerationPlanItem[] = [];

    for (const cycle of cycles) {
      const date = chargeDateForCycle(cycle, subscription.dayOfMonth);

      const item = await this.prisma.$transaction(
        async (tx): Promise<GenerationPlanItem> => {
          let invoiceId: string | undefined;

          if (subscription.type === TransactionType.CREDIT_CARD) {
            // A fatura sai da DATA da cobrança, igual a qualquer compra: o
            // ciclo é o mês em que a assinatura cobra, e a fatura leva o mês
            // do vencimento — uma cobrança no fim de julho pertence à fatura
            // de agosto. Usar o ciclo como período apontava para a fatura
            // errada, geralmente uma anterior já paga.
            //
            // Isso não reabre o risco do dia 31: a idempotência vem de
            // `lastGeneratedFor`, que é por ciclo, então dois ciclos nunca
            // geram dois lançamentos no mesmo período.
            const invoice = await findOrCreateInvoice(
              tx,
              subscription.userId,
              bank.id,
              bank.invoiceDueDate,
              bank.invoiceDueDaysAfterClose,
              date,
            );

            if (invoice.status === 'PAID') {
              // Fatura já conciliada: avança o marcador sem lançar, senão o
              // ciclo ficaria pendente para sempre.
              await tx.subscription.update({
                where: { id: subscription.id },
                data: { lastGeneratedFor: formatCycle(cycle) },
              });
              return {
                cycle: formatCycle(cycle),
                date,
                skipped: true,
                skipReason: 'invoice-paid',
              };
            }

            invoiceId = invoice.id;
          }

          await tx.transaction.create({
            data: {
              userId: subscription.userId,
              subscriptionId: subscription.id,
              bankId: subscription.bankId,
              categoryId: subscription.categoryId,
              invoiceId,
              title: subscription.title,
              type: subscription.type,
              amount: subscription.amount,
              description: subscription.description,
              date,
            },
          });

          if (invoiceId) {
            await tx.invoice.update({
              where: { id: invoiceId, userId: subscription.userId },
              data: { totalAmount: { increment: subscription.amount } },
            });
          }

          await tx.subscription.update({
            where: { id: subscription.id },
            data: { lastGeneratedFor: formatCycle(cycle) },
          });

          return { cycle: formatCycle(cycle), date, skipped: false };
        },
      );

      plan.push(item);
    }

    return plan;
  }
}
