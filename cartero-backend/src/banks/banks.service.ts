import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Bank } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import {
  DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
  getLegacyCloseDay,
  SYSTEM_RECEIVABLE_BANK_NAME,
} from 'src/common/helpers/invoice.helper';
import {
  planBillingConfigUpdate,
  type InvoiceDateChange,
  type PlannableInvoice,
} from './billing-config-plan.helper';
import type { BillingConfigPreview } from './billing-config-preview.types';

/** Recorte da listagem: ativos (padrão) ou arquivados. */
export type BankStatusFilter = 'ACTIVE' | 'ARCHIVED';

@Injectable()
export class BanksService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateBankDto) {
    this.assertNameNotReserved(dto.name);

    const existing = await this.prisma.bank.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Banco já existe');
    }

    const daysAfterClose =
      dto.invoiceDueDaysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE;

    return await this.prisma.bank.create({
      data: {
        userId,
        name: dto.name,
        invoiceCloseDate:
          dto.invoiceCloseDate ??
          getLegacyCloseDay(dto.invoiceDueDate, daysAfterClose),
        invoiceDueDate: dto.invoiceDueDate,
        invoiceDueDaysAfterClose: daysAfterClose,
      },
    });
  }

  /**
   * Recusa o nome técnico da conta interna.
   *
   * Sem isto, um banco comum podia nascer com o nome reservado. O efeito não
   * era cosmético: `findOrCreateSystemReceivableBank` filtra por
   * `isSystem: true`, então não encontraria esse registro e criaria um
   * SEGUNDO com o mesmo nome — dois bancos homônimos, um deles invisível.
   *
   * Bancos históricos com esse nome são preservados: nada é renomeado nem
   * convertido em conta de sistema. A validação só impede novos conflitos.
   */
  private assertNameNotReserved(name: string): void {
    if (name.trim() !== SYSTEM_RECEIVABLE_BANK_NAME) return;

    throw new BadRequestException(
      'Esse nome é reservado para uso interno do sistema',
    );
  }

  async findOne(id: string, userId: string) {
    // Leitura: um banco arquivado precisa continuar abrindo — é por essa tela
    // que se chega às faturas pendentes dele e ao botão de restaurar.
    return await this.entityValidationService.validateBank(id, userId, {
      allowArchived: true,
    });
  }

  /**
   * Bancos do usuário, ativos por padrão.
   *
   * `status` é explícito em vez de um `includeArchived`: a tela de arquivados
   * quer SÓ os arquivados, e uma flag de inclusão não sabe dizer isso — pedir
   * "inclua arquivados" devolveria os ativos junto e obrigaria o cliente a
   * filtrar de novo.
   *
   * `canDelete` vem calculado daqui porque a decisão entre "Excluir" e
   * "Arquivar" é do backend: replicar a contagem no frontend criaria uma
   * segunda regra, que divergiria. Sai do `_count` que a própria query já
   * traz — sem consulta extra por banco.
   */
  async findAll(userId: string, status: BankStatusFilter = 'ACTIVE') {
    const banks = await this.prisma.bank.findMany({
      where: {
        userId,
        isSystem: false,
        isArchived: status === 'ARCHIVED',
      },
      include: {
        _count: {
          select: { transactions: true, invoices: true, subscriptions: true },
        },
      },
    });

    return banks.map((bank) => ({
      ...bank,
      // Mesma condição de `remove`: qualquer vínculo é histórico que a
      // exclusão destruiria.
      canDelete:
        bank._count.transactions === 0 &&
        bank._count.invoices === 0 &&
        bank._count.subscriptions === 0,
    }));
  }

  async update(id: string, userId: string, dto: UpdateBankDto) {
    // Corrigir o vencimento de um cartão encerrado é legítimo, e sem
    // `allowArchived` o próprio formulário de edição ficaria inacessível.
    const bank = await this.entityValidationService.validateBank(id, userId, {
      allowArchived: true,
    });

    /**
     * A conta interna não é editável.
     *
     * `archive` e `remove` já a protegiam; `update` não. Conhecendo o id — que
     * chega ao cliente via `transaction.bank` no extrato — era possível
     * renomeá-la, e aí `findOrCreateSystemReceivableBank`, que busca por nome,
     * criaria uma segunda.
     */
    if (bank.isSystem) {
      throw new BadRequestException(
        'Contas internas do sistema não podem ser editadas',
      );
    }

    if (dto.name !== undefined) this.assertNameNotReserved(dto.name);

    // Campos explícitos: `isSystem` não está no DTO e não pode ser alcançado
    // pelo corpo da requisição — marcar um banco comum como interno o
    // esconderia da listagem e o tornaria não-excluível.
    const data: UpdateBankDto = {
      name: dto.name,
      invoiceCloseDate: dto.invoiceCloseDate,
      invoiceDueDate: dto.invoiceDueDate,
      invoiceDueDaysAfterClose: dto.invoiceDueDaysAfterClose,
    };

    if (
      dto.invoiceDueDate !== undefined ||
      dto.invoiceDueDaysAfterClose !== undefined
    ) {
      const dueDay = dto.invoiceDueDate ?? bank.invoiceDueDate;
      const daysAfterClose =
        dto.invoiceDueDaysAfterClose ??
        bank.invoiceDueDaysAfterClose ??
        DEFAULT_INVOICE_DAYS_AFTER_CLOSE;
      data.invoiceCloseDate = getLegacyCloseDay(dueDay, daysAfterClose);
    }

    const nextSchedule = this.resolveNextSchedule(bank, dto);
    const plan = planBillingConfigUpdate({
      current: bank,
      next: nextSchedule,
      invoices: await this.loadPlannableInvoices(id, userId),
    });

    /**
     * Tudo numa única transação.
     *
     * Um banco com a configuração nova e faturas ainda nas datas antigas seria
     * um estado incoerente que nada corrige depois: o plano não saberia mais
     * quais faturas ficaram para trás, porque a configuração "atual" já é a
     * nova. Ou muda tudo, ou nada muda.
     */
    return await this.prisma.$transaction(async (tx) => {
      const updatedBank = await tx.bank.update({
        where: { id, userId },
        data,
      });

      for (const change of plan.changes) {
        await tx.invoice.update({
          where: { id: change.invoiceId, userId },
          data: {
            closeDate: change.closeDate.after,
            dueDate: change.dueDate.after,
            // Derivar aqui evita o estado contraditório de uma fatura cujo
            // novo fechamento já passou continuar marcada como aberta até o
            // cron da madrugada seguinte.
            status: change.status.after,
            updatedAt: new Date(),
          },
        });

        await this.syncPendingAutoReceivables(tx, userId, change);
      }

      return updatedBank;
    });
  }

  /** Configuração que passa a valer depois do PATCH. */
  private resolveNextSchedule(
    bank: Bank,
    dto: UpdateBankDto,
  ): { invoiceDueDate: number; invoiceDueDaysAfterClose: number } {
    return {
      invoiceDueDate: dto.invoiceDueDate ?? bank.invoiceDueDate,
      invoiceDueDaysAfterClose:
        dto.invoiceDueDaysAfterClose ??
        bank.invoiceDueDaysAfterClose ??
        DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
    };
  }

  /**
   * Faturas do banco, com o mínimo que o plano precisa.
   *
   * Sem filtro por status na query: quem decide elegibilidade é o plano, que
   * também precisa ver as recusadas para relatá-las. Filtrar aqui espalharia a
   * regra por dois lugares.
   */
  private async loadPlannableInvoices(
    bankId: string,
    userId: string,
  ): Promise<PlannableInvoice[]> {
    return await this.prisma.invoice.findMany({
      where: { bankId, userId },
      select: {
        id: true,
        year: true,
        month: true,
        status: true,
        closeDate: true,
        dueDate: true,
      },
    });
  }

  /**
   * Cobranças de terceiros acompanham o novo vencimento da fatura.
   *
   * Uma compra feita para outra pessoa gera um recebível que herda o
   * vencimento da fatura — é quando o dinheiro precisa voltar. Movida a
   * fatura, a cobrança tem de mover junto, senão passa a apontar para uma data
   * que não corresponde a nada.
   *
   * Três exclusões, cada uma por um motivo diferente:
   *
   * - `transactionId: not null` — só as AUTOMÁTICAS. Uma cobrança criada à mão
   *   tem vencimento escolhido pelo usuário e não deriva do cartão.
   * - `isPaid: false` — recebimento é fato concluído. Reescrever a data de uma
   *   cobrança já recebida contradiria o registro do que aconteceu, a mesma
   *   política que protege fatura paga e transação de fatura paga.
   * - vínculo por `transaction.invoiceId` — relação estrutural, nunca título
   *   ou valor.
   */
  private async syncPendingAutoReceivables(
    tx: Prisma.TransactionClient,
    userId: string,
    change: InvoiceDateChange,
  ): Promise<void> {
    await tx.receivable.updateMany({
      where: {
        userId,
        isPaid: false,
        transactionId: { not: null },
        transaction: { invoiceId: change.invoiceId },
      },
      data: { dueDate: change.dueDate.after, updatedAt: new Date() },
    });
  }

  /**
   * Impacto de uma alteração de ciclo, sem gravar nada.
   *
   * Consome o MESMO `planBillingConfigUpdate` que o update usa, então a
   * projeção não pode divergir do que o save fará — a lição das prévias de
   * transação, onde números calculados em dois lugares divergiram.
   */
  async previewBillingConfig(
    id: string,
    userId: string,
    dto: UpdateBankDto,
  ): Promise<BillingConfigPreview> {
    const bank = await this.entityValidationService.validateBank(id, userId, {
      allowArchived: true,
    });

    const plan = planBillingConfigUpdate({
      current: bank,
      next: this.resolveNextSchedule(bank, dto),
      invoices: await this.loadPlannableInvoices(id, userId),
    });

    // Contagem de cobranças: mesma condição de `syncPendingAutoReceivables`.
    const affectedInvoiceIds = plan.changes.map((change) => change.invoiceId);
    const pendingReceivables =
      affectedInvoiceIds.length === 0
        ? 0
        : await this.prisma.receivable.count({
            where: {
              userId,
              isPaid: false,
              transactionId: { not: null },
              transaction: { invoiceId: { in: affectedInvoiceIds } },
            },
          });

    return {
      scheduleUnchanged: plan.scheduleUnchanged,
      affectedCount: plan.changes.length,
      statusChangeCount: plan.changes.filter((change) => change.statusChanged)
        .length,
      pendingReceivables,
      changes: plan.changes.map((change) => ({
        invoiceId: change.invoiceId,
        year: change.year,
        month: change.month,
        closeDate: {
          before: change.closeDate.before.toISOString(),
          after: change.closeDate.after.toISOString(),
        },
        dueDate: {
          before: change.dueDate.before.toISOString(),
          after: change.dueDate.after.toISOString(),
        },
        status: change.status,
        statusChanged: change.statusChanged,
      })),
    };
  }

  /**
   * Arquiva o banco: sai dos lançamentos novos, conserva todo o histórico.
   *
   * Ação de domínio própria, e não `PATCH { isArchived: true }`, porque as
   * guardas abaixo são a razão de existir da operação — expor o campo no DTO
   * de update permitiria contorná-las.
   *
   * O que NÃO acontece: nada é excluído, nenhuma fatura muda de status,
   * nenhuma parcela é cancelada. As faturas do banco seguem fechando,
   * vencendo e podendo ser pagas — um cartão encerrado costuma ter uma última
   * fatura em aberto, e esse fluxo tem de continuar.
   */
  async archive(id: string, userId: string) {
    const bank = await this.entityValidationService.validateBank(id, userId, {
      allowArchived: true,
    });

    if (bank.isSystem) {
      throw new BadRequestException(
        'Contas internas do sistema não podem ser arquivadas',
      );
    }

    // Idempotente: arquivar duas vezes não é erro, e o cliente pode ter
    // perdido a resposta da primeira.
    if (bank.isArchived) return bank;

    /**
     * Assinatura ativa impede o arquivamento.
     *
     * Sem isso o arquivamento seria uma promessa falsa: o usuário arquiva
     * porque não quer mais usar a conta, e o Cartero segue criando
     * transações nela a cada ciclo. Assinatura pausada não gera nada, então
     * não bloqueia — e a reativação dela é barrada enquanto o banco estiver
     * arquivado.
     */
    const activeSubscriptions = await this.prisma.subscription.count({
      where: { bankId: id, userId, isActive: true },
    });

    if (activeSubscriptions > 0) {
      throw new ConflictException({
        message:
          activeSubscriptions === 1
            ? 'Este banco tem 1 assinatura ativa. Pause ou mova a assinatura antes de arquivá-lo.'
            : `Este banco tem ${activeSubscriptions} assinaturas ativas. Pause ou mova as assinaturas antes de arquivá-lo.`,
        code: 'BANK_HAS_ACTIVE_SUBSCRIPTIONS',
        details: { activeSubscriptions },
      });
    }

    return await this.prisma.bank.update({
      where: { id, userId },
      data: { isArchived: true, updatedAt: new Date() },
    });
  }

  /**
   * Restaura o banco: volta a aceitar lançamentos.
   *
   * Não toca em faturas, transações nem configuração, e não reativa
   * assinaturas pausadas — quem pausou decide quando retomar.
   */
  async restore(id: string, userId: string) {
    const bank = await this.entityValidationService.validateBank(id, userId, {
      allowArchived: true,
    });

    if (!bank.isArchived) return bank;

    return await this.prisma.bank.update({
      where: { id, userId },
      data: { isArchived: false, updatedAt: new Date() },
    });
  }

  /**
   * Banco com histórico financeiro não é excluível.
   *
   * A versão anterior apagava tudo: transações, faturas, e ainda desvinculava
   * pagamentos de dívidas e cobranças — que continuavam marcados como pagos,
   * agora sem nenhuma transação que comprovasse o pagamento. As guardas que
   * impediriam isso existiam mas estavam desativadas por `&& false`.
   *
   * Um banco realmente sem uso continua podendo ser removido. Para um cartão
   * encerrado cujo histórico importa, a saída será o arquivamento (fase
   * posterior); até lá, o registro é preservado.
   */
  async remove(id: string, userId: string) {
    const bank = await this.prisma.bank.findUnique({
      where: { id, userId },
    });

    if (!bank) {
      throw new NotFoundException('Banco não encontrado');
    }

    if (bank.isSystem) {
      throw new BadRequestException(
        'Contas internas do sistema não podem ser excluídas',
      );
    }

    // Qualquer vínculo abaixo representa histórico que seria destruído junto.
    // Assinaturas entram na conta porque o `bankId` é obrigatório nelas:
    // apagar o banco quebraria a regra recorrente.
    const [transactions, invoices, subscriptions] = await Promise.all([
      this.prisma.transaction.count({ where: { bankId: id, userId } }),
      this.prisma.invoice.count({ where: { bankId: id, userId } }),
      this.prisma.subscription.count({ where: { bankId: id, userId } }),
    ]);

    if (transactions > 0 || invoices > 0 || subscriptions > 0) {
      throw new ConflictException({
        message:
          'Este banco possui histórico financeiro e não pode ser excluído.',
        code: 'BANK_HAS_HISTORY',
        details: { transactions, invoices, subscriptions },
      });
    }

    await this.prisma.bank.delete({ where: { id, userId } });

    return;
  }
}
