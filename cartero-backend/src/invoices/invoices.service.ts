import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { deriveStatusFromInvoiceDates } from 'src/common/helpers/invoice.helper';
import {
  selectActionableInvoices,
  type ActionableInvoiceCandidate,
} from 'src/common/helpers/actionable-invoices.helper';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { MarkManyPaidDto } from './dto/mark-many-paid.dto';
import { findOrCreateSystemReceivableBank } from 'src/common/helpers/invoice.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import { requireAccountTimeZone } from 'src/common/helpers/timezone.helper';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import { resolveSettlementDate } from 'src/common/helpers/settlement.core';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async findOne(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id, userId },
      include: {
        transactions: {
          include: {
            category: {
              select: { id: true, name: true, color: true, icon: true },
            },
            person: { select: { id: true, name: true } },
          },
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');
    return invoice;
  }

  async findAll(userId: string, filters: FindInvoicesDto = {}) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        userId,
        bankId: filters.bankId,
        month: filters.month,
        year: filters.year,
      },
      include: { bank: true },
    });

    if (invoices.length === 0) return invoices;

    // Quanto de cada fatura pertence a outra pessoa. Uma única consulta
    // agrupada para todas as faturas da lista — a alternativa seria hidratar
    // as transações de cada uma só para somar.
    //
    // `totalAmount` continua bruto: é o valor que o banco cobra. Os campos
    // abaixo são leituras derivadas para as telas que falam de custo pessoal.
    const reimbursableByInvoice = await this.prisma.transaction.groupBy({
      by: ['invoiceId'],
      where: {
        userId,
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
        personId: { not: null },
        type: 'CREDIT_CARD',
      },
      _sum: { amount: true },
    });

    const perInvoice = new Map<string, number>();
    for (const row of reimbursableByInvoice) {
      if (!row.invoiceId) continue;
      perInvoice.set(row.invoiceId, Number(row._sum.amount ?? 0));
    }

    return invoices.map((invoice) => {
      const reimbursable = perInvoice.get(invoice.id) ?? 0;
      return {
        ...invoice,
        reimbursable,
        ownAmount: Number(invoice.totalAmount) - reimbursable,
      };
    });
  }

  /**
   * `GET /invoices/actionable` — "o que exige atenção agora?".
   *
   * A seleção/ordenação/limite vivem inteiramente em
   * `selectActionableInvoices` (authority pura); este método só busca o
   * conjunto mínimo relevante e traduz para o formato que a authority espera.
   *
   * ── Estratégia de query ──
   *
   * `status: { not: PAID }` e `totalAmount: { gt: 0 }` já eliminam no banco a
   * maior parte do histórico que nunca seria actionable — não há motivo para
   * carregar faturas pagas de anos atrás só para descartá-las em memória. O
   * restante (prioridade por status, `actionDate` que muda de campo conforme
   * o status, desempate por nome) fica na authority: não cabe num único
   * `orderBy` do Prisma sem sacrificar clareza, e o volume já filtrado é
   * pequeno o bastante para ordenar em memória sem custo real.
   */
  async findActionable(userId: string, limit: number) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        userId,
        status: { not: InvoiceStatus.PAID },
        totalAmount: { gt: 0 },
      },
      include: { bank: { select: { name: true } } },
    });

    if (invoices.length === 0) return { items: [] };

    // Mesma agregação de `findAll`: quanto de cada fatura pertence a outra
    // pessoa, numa única consulta agrupada em vez de uma por fatura.
    const reimbursableByInvoice = await this.prisma.transaction.groupBy({
      by: ['invoiceId'],
      where: {
        userId,
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
        personId: { not: null },
        type: 'CREDIT_CARD',
      },
      _sum: { amount: true },
    });

    const perInvoice = new Map<string, number>();
    for (const row of reimbursableByInvoice) {
      if (!row.invoiceId) continue;
      perInvoice.set(row.invoiceId, Number(row._sum.amount ?? 0));
    }

    const candidates: ActionableInvoiceCandidate[] = invoices.map((invoice) => ({
      // Identidade real do banco, para agrupar (M5A.1) — nunca exposta.
      bankId: invoice.bankId,
      bankName: invoice.bank.name,
      // Desempate determinístico (M5A.2) — já vêm na row, sem query extra.
      invoiceId: invoice.id,
      year: invoice.year,
      month: invoice.month,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      closeDate: invoice.closeDate,
      dueDate: invoice.dueDate,
      reimbursable: perInvoice.get(invoice.id) ?? 0,
    }));

    return { items: selectActionableInvoices(candidates, limit) };
  }

  async update(id: string, userId: string, dto: UpdateInvoiceDto) {
    const existing = await this.entityValidationService.validateInvoice(id, userId);
    if (existing.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Fatura paga só pode ser reaberta pelo fluxo de reabertura');
    }
    if (dto.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Use o fluxo de pagamento da fatura');
    }

    return await this.prisma.invoice.update({
      where: { id, userId },
      data: dto,
    });
  }

  /**
   * Desfaz o pagamento de uma fatura, devolvendo o status que ela teria pelas
   * próprias datas. Necessário para editar lançamentos de uma fatura paga —
   * a edição é bloqueada enquanto ela estiver nesse estado.
   *
   * TZ6.1: `timeZone` vem de `@CurrentUser()`, já disponível no controller —
   * nenhuma query nova. Contas com timezone configurada precisam derivar
   * pela MESMA authority que o scheduler usa (TZ2/Intl-IANA), senão reabrir
   * e o cron discordariam do status de uma fatura da mesma conta.
   * `timeZone === null` preserva a derivação UTC exata de sempre.
   */
  async reopen(id: string, userId: string, timeZone: string | null = null) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id, userId },
      include: { bank: true },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');

    if (invoice.status !== 'PAID') {
      throw new BadRequestException('A fatura não está paga');
    }

    if (!(this.prisma as any).invoiceSettlement) {
      return this.prisma.invoice.update({
        where: { id, userId },
        data: { status: deriveStatusFromInvoiceDates(invoice, new Date(), timeZone) },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceSettlement.deleteMany({ where: { invoiceId: invoice.id } });
      return tx.invoice.update({
        where: { id, userId },
        data: {
        // Das datas congeladas da própria fatura, não da configuração atual
        // do banco: reabrir não é motivo para recalcular o calendário de uma
        // fatura histórica.
          status: deriveStatusFromInvoiceDates(invoice, new Date(), timeZone),
        },
      });
    });
  }

  /**
   * Reabre todas as faturas pagas de uma vez — atalho de manutenção para
   * corrigir lançamentos antigos sem abrir fatura por fatura.
   *
   * Devolve os ids afetados: quem chamou precisa deles para desfazer depois,
   * já que o registro não guarda por que uma fatura foi reaberta.
   */
  async reopenAllPaid(userId: string, timeZone: string | null = null) {
    const paid = await this.prisma.invoice.findMany({
      where: { userId, status: 'PAID' },
      include: { bank: true },
    });

    const now = new Date();

    if (!(this.prisma as any).invoiceSettlement) {
      await this.prisma.$transaction(
        paid.map((invoice) =>
          this.prisma.invoice.update({
            where: { id: invoice.id, userId },
            data: { status: deriveStatusFromInvoiceDates(invoice, now, timeZone) },
          }),
        ),
      );
    } else {
      await this.prisma.$transaction(async (tx) => {
        for (const invoice of paid) {
          await tx.invoiceSettlement.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.invoice.update({
            where: { id: invoice.id, userId },
            data: { status: deriveStatusFromInvoiceDates(invoice, now, timeZone) },
          });
        }
      });
    }

    return { ids: paid.map((invoice) => invoice.id), count: paid.length };
  }

  /**
   * Marca como pagas as faturas indicadas — o inverso de `reopenAllPaid`.
   *
   * Só age sobre faturas que não estejam pagas: se o usuário quitou alguma
   * durante a manutenção, ela já está no estado certo e é ignorada.
   */
  async markManyPaid(
    userId: string,
    dto: MarkManyPaidDto,
    timeZone: string | null = null,
  ) {
    const ids = [...new Set(dto.ids)];
    if (ids.length === 0) return { count: 0 };

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const accountTimeZone = timeZone ?? user.timeZone;
    const today = financialCivilDay(new Date(), requireAccountTimeZone(accountTimeZone));
    const paidAt = dto.paymentDate
      ? resolveSettlementDate(dto.paymentDate, new Date(), accountTimeZone)
      : parseDateOnly(today);

    const selectedBank = dto.bankId
      ? await this.entityValidationService.validateBank(dto.bankId, userId)
      : null;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const requestedInvoices = await tx.invoice.findMany({
        where: { userId, id: { in: ids } },
      });
      if (requestedInvoices.length !== ids.length) {
        throw new NotFoundException('Uma ou mais faturas não pertencem à conta ou já estão pagas');
      }
      const invoices = requestedInvoices.filter((invoice) => invoice.status !== InvoiceStatus.PAID);
      if (invoices.length === 0) return { count: 0 };
      const bank = selectedBank ?? (await findOrCreateSystemReceivableBank(tx, userId));
      for (const invoice of invoices) {
        await tx.invoiceSettlement.create({
          data: {
            invoiceId: invoice.id,
            amount: invoice.totalAmount,
            paidAt,
            bankId: bank.id,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id, userId },
          data: { status: InvoiceStatus.PAID },
        });
      }
      return { count: invoices.length };
    });
  }
}
