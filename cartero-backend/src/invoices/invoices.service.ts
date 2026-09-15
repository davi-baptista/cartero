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
import { InvoiceStatus } from '@prisma/client';

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
      bankName: invoice.bank.name,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      closeDate: invoice.closeDate,
      dueDate: invoice.dueDate,
      reimbursable: perInvoice.get(invoice.id) ?? 0,
    }));

    return { items: selectActionableInvoices(candidates, limit) };
  }

  async update(id: string, userId: string, dto: UpdateInvoiceDto) {
    await this.entityValidationService.validateInvoice(id, userId);

    return await this.prisma.invoice.update({
      where: { id, userId },
      data: dto,
    });
  }

  /**
   * Desfaz o pagamento de uma fatura, devolvendo o status que ela teria pelas
   * próprias datas. Necessário para editar lançamentos de uma fatura paga —
   * a edição é bloqueada enquanto ela estiver nesse estado.
   */
  async reopen(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id, userId },
      include: { bank: true },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');

    if (invoice.status !== 'PAID') {
      throw new BadRequestException('A fatura não está paga');
    }

    return this.prisma.invoice.update({
      where: { id, userId },
      data: {
        // Das datas congeladas da própria fatura, não da configuração atual
        // do banco: reabrir não é motivo para recalcular o calendário de uma
        // fatura histórica.
        status: deriveStatusFromInvoiceDates(invoice),
      },
    });
  }

  /**
   * Reabre todas as faturas pagas de uma vez — atalho de manutenção para
   * corrigir lançamentos antigos sem abrir fatura por fatura.
   *
   * Devolve os ids afetados: quem chamou precisa deles para desfazer depois,
   * já que o registro não guarda por que uma fatura foi reaberta.
   */
  async reopenAllPaid(userId: string) {
    const paid = await this.prisma.invoice.findMany({
      where: { userId, status: 'PAID' },
      include: { bank: true },
    });

    await this.prisma.$transaction(
      paid.map((invoice) =>
        this.prisma.invoice.update({
          where: { id: invoice.id, userId },
          data: {
            status: deriveStatusFromInvoiceDates(invoice),
          },
        }),
      ),
    );

    return { ids: paid.map((invoice) => invoice.id), count: paid.length };
  }

  /**
   * Marca como pagas as faturas indicadas — o inverso de `reopenAllPaid`.
   *
   * Só age sobre faturas que não estejam pagas: se o usuário quitou alguma
   * durante a manutenção, ela já está no estado certo e é ignorada.
   */
  async markManyPaid(userId: string, ids: string[]) {
    if (ids.length === 0) return { count: 0 };

    const result = await this.prisma.invoice.updateMany({
      where: { userId, id: { in: ids }, status: { not: 'PAID' } },
      data: { status: 'PAID' },
    });

    return { count: result.count };
  }
}
