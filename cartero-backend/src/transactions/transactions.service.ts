import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  Bank,
  Invoice,
  Person,
  Prisma,
  Receivable,
  Transaction,
} from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import {
  deleteInvoiceIfEmpty,
  findOrCreateInvoice,
  findOrCreateInvoiceForPeriod,
  getInvoiceDueDate,
  getInvoiceDueDateForPeriod,
  getInvoicePeriodForDate,
  offsetInvoicePeriod,
} from 'src/common/helpers/invoice.helper';
import { planTransaction } from './transaction-plan.helper';
import {
  belongsToInstallmentSeries,
  round2,
} from 'src/common/helpers/installment.helper';
import {
  assertRefundHasNoPerson,
  isRefundWithPerson,
  REFUND_PERSON_NOT_SUPPORTED,
} from './refund-person.guard';
import { PreviewTransactionDto } from './dto/preview-transaction.dto';
import { PreviewUpdateTransactionDto } from './dto/preview-update-transaction.dto';
import type { TransactionUpdatePreview } from './transaction-update-preview.types';
import type { TransactionPreview } from './transaction-preview.types';
import {
  serializeDeletePlan,
  type TransactionDeletePreview,
  type TransactionDeleteResult,
} from './transaction-delete-preview.types';
import {
  buildInstallmentDeletePlan,
  deletableSetChanged,
  type InstallmentCandidate,
  type InstallmentDeletePlan,
  type InstallmentProtectionFacts,
} from 'src/common/helpers/installment-delete-plan';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from 'src/transactions/dto/create-transaction.dto';
import { FindTransactionsDto } from 'src/transactions/dto/find-transactions.dto';
import { UpdateTransactionDto } from 'src/transactions/dto/update-transaction.dto';
import {
  parseDateFilterEnd,
  parseDateFilterStart,
  parseDateOnly,
} from 'src/common/helpers/date-only.helper';

type TransactionScope = 'ONE' | 'NEXT' | 'ALL';

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateTransactionDto) {
    const bank = await this.entityValidationService.validateBank(
      dto.bankId,
      userId,
    );
    await this.entityValidationService.validateCategory(dto.categoryId, userId);

    if (dto.personId && dto.type !== 'CREDIT_CARD') {
      throw new BadRequestException(
        'Só é possível vincular uma pessoa a transações de cartão de crédito',
      );
    }

    if (dto.isRefund && dto.type !== 'CREDIT_CARD') {
      throw new BadRequestException(
        'Reembolsos devem ser transações de cartão de crédito',
      );
    }

    assertRefundHasNoPerson(dto.isRefund, dto.personId);

    let person: Person | null = null;
    if (dto.personId) {
      person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const originalDate = parseDateOnly(dto.date);

        // Mesmo plano que a prévia usa: quantidade de parcelas, rateio do
        // total e sequência de competências saem daqui, então as duas nunca
        // divergem. `dto.amount` é o TOTAL da compra.
        const plan = planTransaction({
          type: dto.type,
          title: dto.title,
          amount: dto.amount,
          date: originalDate,
          installments: dto.installments,
          isRefund: dto.isRefund,
          schedule: {
            invoiceDueDate: bank.invoiceDueDate,
            invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
          },
        });

        const installments = plan.installmentCount;
        const installmentAmounts = plan.installments.map(
          (installment) => installment.amount,
        );

        const transactions: Transaction[] = [];
        let firstInvoicePeriod: { year: number; month: number } | null = null;

        let parentId: string | null = null;
        let receivableParentId: string | null = null;

        for (let i = 0; i < installments; i++) {
          const installmentAmount = installmentAmounts[i];
          let invoiceId: string | null = null;
          let invoice: Invoice | null = null;
          const installmentDate = originalDate;

          if (dto.type == 'CREDIT_CARD') {
            if (i === 0) {
              invoice = await findOrCreateInvoice(
                tx,
                userId,
                dto.bankId,
                bank.invoiceDueDate,
                bank.invoiceDueDaysAfterClose,
                originalDate,
              );
              firstInvoicePeriod = {
                year: invoice.year,
                month: invoice.month,
              };
            } else {
              const period = offsetInvoicePeriod(
                firstInvoicePeriod!.year,
                firstInvoicePeriod!.month,
                i,
              );
              invoice = await findOrCreateInvoiceForPeriod(
                tx,
                userId,
                dto.bankId,
                {
                  invoiceDueDate: bank.invoiceDueDate,
                  invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
                },
                period.year,
                period.month,
              );
            }

            // Uma fatura paga não pode receber lançamentos novos: o total
            // mudaria depois do pagamento, deixando registrado como quitado um
            // valor diferente do que foi pago. Vale para qualquer parcela —
            // um parcelamento longo pode atravessar uma fatura ja quitada.
            if (invoice.status === 'PAID') {
              throw new ForbiddenException(
                installments > 1
                  ? 'Não é possível lançar: uma das faturas do parcelamento já está paga'
                  : 'Não é possível lançar em uma fatura já paga',
              );
            }

            invoiceId = invoice.id;
          }

          const title = plan.installments[i].title;

          const transaction: Transaction = await tx.transaction.create({
            data: {
              userId,
              invoiceId,
              parentId,
              personId: dto.personId,
              bankId: dto.bankId,
              categoryId: dto.categoryId,
              title,
              type: dto.type,
              amount: installmentAmount,
              isRefund: dto.isRefund ?? false,
              description: dto.description,
              date: installmentDate,
            },
          });

          if (i === 0 && installments > 1) {
            parentId = transaction.id;
          }

          if (invoiceId) {
            await tx.invoice.update({
              where: { id: invoiceId, userId },
              data: {
                totalAmount: dto.isRefund
                  ? { decrement: installmentAmount }
                  : { increment: installmentAmount },
              },
            });
          }

          if (dto.personId && person && invoice) {
            // A fatura acabou de ser criada/lida com as datas já persistidas — a
            // cobrança herda exatamente o que ela guarda.
            const dueDate = getInvoiceDueDate(invoice);

            const receivable: Receivable = await tx.receivable.create({
              data: {
                userId,
                personId: dto.personId,
                parentId: receivableParentId,
                transactionId: transaction.id,
                title,
                debtorName: person.name,
                amount: installmentAmount,
                occurredAt: installmentDate,
                dueDate,
              },
            });

            if (i === 0 && installments > 1) {
              receivableParentId = receivable.id;
            }
          }

          transactions.push(transaction);
        }
        return transactions;
      },
    );
  }

  /**
   * Consequências de uma criação, sem persistir nada.
   *
   * Deriva do mesmo `planTransaction` que a criação usa, então a prévia não
   * pode divergir do que será gravado. Consulta faturas existentes apenas para
   * relatar o estado delas (uma fatura PAID recusaria o lançamento) — nunca
   * cria fatura, transação ou recebível, e nunca mexe em `totalAmount`.
   */
  async previewCreate(
    userId: string,
    dto: PreviewTransactionDto,
  ): Promise<TransactionPreview> {
    const bank = await this.entityValidationService.validateBank(
      dto.bankId,
      userId,
    );

    if (dto.personId && dto.type !== 'CREDIT_CARD') {
      throw new BadRequestException(
        'Só é possível vincular uma pessoa a transações de cartão de crédito',
      );
    }

    if (dto.isRefund && dto.type !== 'CREDIT_CARD') {
      throw new BadRequestException(
        'Reembolsos devem ser transações de cartão de crédito',
      );
    }

    // A prévia não pode prometer uma operação que a criação vai recusar.
    assertRefundHasNoPerson(dto.isRefund, dto.personId);

    const person = dto.personId
      ? await this.entityValidationService.validatePerson(dto.personId, userId)
      : null;

    const plan = planTransaction({
      type: dto.type,
      title: dto.title,
      amount: dto.amount,
      date: parseDateOnly(dto.date),
      installments: dto.installments,
      isRefund: dto.isRefund,
      schedule: {
        invoiceDueDate: bank.invoiceDueDate,
        invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
      },
    });

    // Uma consulta só para todas as competências do plano — nunca uma por
    // parcela, senão um parcelamento de 36x viraria 36 idas ao banco.
    const periods = plan.installments
      .map((installment) => installment.period)
      .filter((period): period is { year: number; month: number } => !!period);

    const existingInvoices =
      periods.length > 0
        ? await this.prisma.invoice.findMany({
            where: {
              userId,
              bankId: dto.bankId,
              OR: periods.map(({ year, month }) => ({ year, month })),
            },
            // `closeDate`/`dueDate` entram aqui porque uma fatura que já
            // existe tem datas CONGELADAS: exibir as prospectivas faria a
            // prévia prometer um vencimento diferente do que o save usaria.
            select: {
              id: true,
              year: true,
              month: true,
              status: true,
              closeDate: true,
              dueDate: true,
            },
          })
        : [];

    const invoiceByPeriod = new Map(
      existingInvoices.map((invoice) => [
        `${invoice.year}-${invoice.month}`,
        invoice,
      ]),
    );

    const installments = plan.installments.map((installment) => {
      const existing = installment.period
        ? invoiceByPeriod.get(
            `${installment.period.year}-${installment.period.month}`,
          )
        : undefined;

      return {
        number: installment.number,
        of: plan.installmentCount,
        amount: installment.amount,
        title: installment.title,
        invoice: installment.period
          ? {
              year: installment.period.year,
              month: installment.period.month,
              // Fatura existente manda: suas datas são fato. Só quando ela
              // ainda não existe a projeção prospectiva vale — e é exatamente
              // ela que o save vai persistir.
              dueDate: existing?.dueDate ?? installment.dueDate,
              closeDate: existing?.closeDate ?? installment.closeDate,
              /** `null` quando a fatura ainda não existe — será criada no save. */
              status: existing?.status ?? null,
              exists: Boolean(existing),
            }
          : null,
      };
    });

    // A criação recusa lançar em fatura paga; a prévia avisa antes.
    const blockedByPaidInvoice = installments.some(
      (installment) => installment.invoice?.status === 'PAID',
    );

    return {
      type: plan.type,
      isRefund: plan.isRefund,
      totalAmount: plan.totalAmount,
      installmentCount: plan.installmentCount,
      affectsInvoice: plan.affectsInvoice,
      installments,
      // O recebível espelha a parcela: mesmo valor, vencimento da mesma fatura.
      receivables:
        person && !plan.isRefund
          ? {
              personId: person.id,
              personName: person.name,
              total: plan.totalAmount,
              count: plan.installmentCount,
              items: installments.map((installment) => ({
                number: installment.number,
                amount: installment.amount,
                dueDate: installment.invoice?.dueDate ?? null,
              })),
            }
          : null,
      blocked: blockedByPaidInvoice
        ? {
            code: 'INVOICE_ALREADY_PAID',
            message:
              plan.installmentCount > 1
                ? 'Uma das faturas do parcelamento já está paga e não pode receber lançamentos.'
                : 'Esta fatura já está paga e não pode receber lançamentos.',
          }
        : null,
    };
  }

  /**
   * Impacto de uma edição, sem gravar nada.
   *
   * Usa os MESMOS seletores de escopo do update (`getTransactionsByScope`,
   * `getInstallmentSeries`) e as mesmas guardas (`assertNoPaidReceivableAffected`,
   * `assertInvoiceReassignmentAllowed`), então a projeção não pode divergir do
   * que o save fará. Só consulta — nenhuma escrita, nenhuma `$transaction`.
   */
  async previewUpdate(
    id: string,
    userId: string,
    dto: PreviewUpdateTransactionDto,
  ): Promise<TransactionUpdatePreview> {
    const existing = await this.entityValidationService.validateTransaction(
      id,
      userId,
    );

    /* A MESMA autoridade do delete: lineage, não cardinalidade atual. */
    const isInstallment = belongsToInstallmentSeries(existing);

    // A data pertence à compra inteira: alterá-la força ALL, como no update.
    const editingInstallmentDate =
      isInstallment &&
      Boolean(dto.date) &&
      parseDateOnly(dto.date as string).getTime() !== existing.date.getTime();

    const requestedScope = this.normalizeScope(dto.scope);
    const scope: TransactionScope = editingInstallmentDate
      ? 'ALL'
      : requestedScope;

    // `scope` já é 'ALL' quando a data muda; o seletor cobre a série inteira.
    const affected = await this.getTransactionsByScope(
      this.prisma,
      existing,
      userId,
      scope,
    );

    // Título em parcelamento é travado pelo update; a prévia reflete isso.
    const effectiveTitle = isInstallment ? undefined : dto.title;
    const personIdProvided = dto.personId !== undefined;
    const effectivePersonId = personIdProvided
      ? dto.personId
      : existing.personId;
    const effectiveIsRefund = dto.isRefund ?? existing.isRefund;

    const amountChanged =
      dto.amount !== undefined && dto.amount !== Number(existing.amount);
    const personChanged =
      personIdProvided && dto.personId !== existing.personId;
    const bankChanged =
      dto.bankId !== undefined && dto.bankId !== existing.bankId;
    const typeChanged = dto.type !== undefined && dto.type !== existing.type;
    const refundChanged =
      dto.isRefund !== undefined && dto.isRefund !== existing.isRefund;

    const changesFinancials =
      amountChanged ||
      personChanged ||
      bankChanged ||
      typeChanged ||
      refundChanged ||
      editingInstallmentDate ||
      (Boolean(dto.date) &&
        parseDateOnly(dto.date as string).getTime() !== existing.date.getTime());

    const preview: TransactionUpdatePreview = {
      affectedCount: affected.length,
      descriptiveOnly: !changesFinancials,
      scope,
      scopeForced: editingInstallmentDate,
      amountPerInstallment: null,
      affectedTotal: null,
      seriesTotal: null,
      invoiceChanges: [],
      person: null,
      blocked: null,
      requiresConfirmation: null,
    };

    // Estorno + pessoa: recusado antes de qualquer projeção.
    if (
      isRefundWithPerson(effectiveIsRefund, effectivePersonId) &&
      (refundChanged || personChanged)
    ) {
      preview.blocked = {
        code: REFUND_PERSON_NOT_SUPPORTED,
        message: 'Um estorno não pode ser vinculado a outra pessoa.',
      };
      return preview;
    }

    /**
     * Mover a transação para um banco arquivado.
     *
     * Testado aqui, fora do bloco de fatura, porque o update recusa a troca
     * para qualquer tipo — e a prévia não pode prometer o que o save nega. A
     * condição é a troca, não o estado atual: uma transação que já mora num
     * banco arquivado continua editável.
     */
    if (bankChanged) {
      const target = await this.prisma.bank.findUnique({
        where: { id: dto.bankId as string, userId },
        select: { name: true, isArchived: true },
      });
      if (target?.isArchived) {
        preview.blocked = {
          code: 'BANK_ARCHIVED',
          message: `${target.name} está arquivado e não aceita novos lançamentos. Restaure o banco para voltar a usá-lo.`,
        };
        return preview;
      }
    }

    // Valores: soma REAL dos registros, nunca valor × quantidade.
    if (amountChanged) {
      const newAmount = dto.amount as number;
      const beforeAffected = affected.reduce(
        (sum, transaction) => sum + Number(transaction.amount),
        0,
      );

      preview.amountPerInstallment = {
        before: Number(existing.amount),
        after: newAmount,
      };
      preview.affectedTotal = {
        before: round2(beforeAffected),
        after: round2(newAmount * affected.length),
      };

      if (isInstallment) {
        const series = await this.getInstallmentSeries(
          this.prisma,
          existing,
          userId,
        );
        const affectedIds = new Set(affected.map((item) => item.id));
        const seriesBefore = series.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        );
        const seriesAfter = series.reduce(
          (sum, item) =>
            sum + (affectedIds.has(item.id) ? newAmount : Number(item.amount)),
          0,
        );
        preview.seriesTotal = {
          before: round2(seriesBefore),
          after: round2(seriesAfter),
        };
      }
    }

    // Competência/vencimento: só quando banco ou data mudam.
    if ((bankChanged || editingInstallmentDate) && existing.type === 'CREDIT_CARD') {
      // Banco arquivado como DESTINO já saiu como `blocked` acima; aqui a
      // transação pode simplesmente já pertencer a um banco arquivado.
      const bank = await this.entityValidationService.validateBank(
        dto.bankId ?? existing.bankId,
        userId,
        { allowArchived: true },
      );
      const schedule = {
        invoiceDueDate: bank.invoiceDueDate,
        invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
      };
      const baseDate = dto.date ? parseDateOnly(dto.date) : existing.date;
      const firstPeriod = getInvoicePeriodForDate(schedule, baseDate);

      const currentInvoices = await this.prisma.invoice.findMany({
        where: {
          userId,
          id: {
            in: affected
              .map((item) => item.invoiceId)
              .filter((invoiceId): invoiceId is string => invoiceId !== null),
          },
        },
        // Datas persistidas: o `before` da projeção tem de ser o que a fatura
        // realmente guarda, não um recálculo pela configuração atual.
        select: {
          id: true,
          year: true,
          month: true,
          closeDate: true,
          dueDate: true,
        },
      });
      const invoiceById = new Map(
        currentInvoices.map((invoice) => [invoice.id, invoice]),
      );

      /**
       * Faturas de DESTINO que já existem.
       *
       * Quando a transação vai para uma competência que já tem fatura, o
       * vencimento projetado precisa ser o dela — congelado — e não o que a
       * configuração atual produziria. Uma consulta só, cobrindo todas as
       * competências alcançadas; sem N+1 por parcela.
       */
      const targetPeriods = affected.map((transaction) => {
        const index = this.getInstallmentIndex(transaction) ?? 0;
        return editingInstallmentDate
          ? offsetInvoicePeriod(firstPeriod.year, firstPeriod.month, index)
          : firstPeriod;
      });

      const targetInvoices = await this.prisma.invoice.findMany({
        where: {
          userId,
          bankId: dto.bankId ?? existing.bankId,
          OR: targetPeriods.map(({ year, month }) => ({ year, month })),
        },
        select: { year: true, month: true, dueDate: true },
      });
      const targetByPeriod = new Map(
        targetInvoices.map((invoice) => [
          `${invoice.year}-${invoice.month}`,
          invoice,
        ]),
      );

      preview.invoiceChanges = affected.map((transaction) => {
        const index = this.getInstallmentIndex(transaction) ?? 0;
        const period = editingInstallmentDate
          ? offsetInvoicePeriod(firstPeriod.year, firstPeriod.month, index)
          : firstPeriod;
        const current = transaction.invoiceId
          ? invoiceById.get(transaction.invoiceId)
          : undefined;

        return {
          installmentNumber: this.getInstallmentIndex(transaction) !== null
            ? index + 1
            : null,
          from: current ? { year: current.year, month: current.month } : null,
          to: { year: period.year, month: period.month },
          dueDate: {
            // Congelado, direto da fatura de origem.
            before: current ? current.dueDate.toISOString() : null,
            // Fatura de destino existente manda; se ainda não existe, a data
            // prospectiva é a que o save vai persistir ao criá-la.
            after: (
              targetByPeriod.get(`${period.year}-${period.month}`)?.dueDate ??
              getInvoiceDueDateForPeriod(schedule, period.year, period.month)
            ).toISOString(),
          },
        };
      });
    }

    // Pessoa: quantas cobranças nascem, mudam ou desaparecem.
    if (personChanged || (amountChanged && effectivePersonId)) {
      const before = existing.personId
        ? await this.entityValidationService.validatePerson(
            existing.personId,
            userId,
          )
        : null;
      const after = effectivePersonId
        ? await this.entityValidationService.validatePerson(
            effectivePersonId,
            userId,
          )
        : null;

      const existingReceivables = await this.prisma.receivable.findMany({
        where: {
          userId,
          transactionId: { in: affected.map((item) => item.id) },
        },
        select: { id: true },
      });

      const willHave = Boolean(effectivePersonId) && !effectiveIsRefund;
      preview.person = {
        before: before ? { id: before.id, name: before.name } : null,
        after: after ? { id: after.id, name: after.name } : null,
        receivablesCreated:
          willHave && existingReceivables.length === 0 ? affected.length : 0,
        receivablesUpdated: willHave ? existingReceivables.length : 0,
        receivablesRemoved: !willHave ? existingReceivables.length : 0,
      };
    }

    if (!changesFinancials) return preview;

    // As guardas reais do update, executadas para relatar — não para escrever.
    try {
      await this.assertNoPaidReceivableAffected(
        existing,
        userId,
        { ...dto, title: effectiveTitle } as UpdateTransactionDto,
        scope,
      );
    } catch {
      const paidCount = await this.prisma.receivable.count({
        where: {
          userId,
          isPaid: true,
          transactionId: { in: affected.map((item) => item.id) },
        },
      });
      preview.blocked = {
        code: 'RECEIVABLE_ALREADY_PAID',
        message:
          paidCount > 1
            ? `${paidCount} cobranças desta compra já foram recebidas. Desfaça os recebimentos antes de alterar os dados financeiros.`
            : 'Um valor desta compra já foi recebido. Desfaça o recebimento antes de alterar os dados financeiros.',
      };
      return preview;
    }

    /**
     * A transação é o comprovante de uma quitação?
     *
     * O save recusa alterar os fatos financeiros dela, então a prévia precisa
     * dizer isso antes — prometer o que o save nega é pior que não projetar.
     */
    if (this.changesPaymentFacts(dto as UpdateTransactionDto, existing)) {
      try {
        await this.assertNotAPaymentTransaction(
          [existing],
          userId,
          this.prisma,
          'update',
        );
      } catch (error) {
        const response = (error as { response?: { message?: string } }).response;
        preview.blocked = {
          code: 'PAYMENT_TRANSACTION_LINKED',
          message:
            response?.message ??
            'Este lançamento registra a quitação de uma pendência.',
        };
        return preview;
      }
    }

    if (editingInstallmentDate) {
      try {
        await this.assertInvoiceReassignmentAllowed(existing, userId, {
          ...dto,
          confirmReopenClosedInvoice: false,
        } as UpdateTransactionDto);
      } catch (error) {
        const response = (error as { response?: { code?: string } }).response;
        if (response?.code === 'CLOSED_INVOICE_REASSIGNMENT') {
          preview.requiresConfirmation = {
            code: 'CLOSED_INVOICE_REASSIGNMENT',
            message:
              'Esta alteração move o lançamento para uma fatura já fechada.',
          };
        } else {
          preview.blocked = {
            code: 'INVOICE_ALREADY_PAID',
            message:
              'Uma das faturas afetadas já está paga e não pode ser alterada.',
          };
        }
      }
    }

    return preview;
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateTransaction(id, userId);
  }

  async findAll(userId: string, filters: FindTransactionsDto = {}) {
    const dateFilter = {
      gte: filters.startDate
        ? parseDateFilterStart(filters.startDate)
        : undefined,
      lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
    };

    const invoicePeriods = filters.invoicePeriod
      ? this.getInvoicePeriods(filters.startDate, filters.endDate)
      : [];

    // The original purchase date is intentionally preserved on every
    // installment. Callers that need invoice-period semantics can opt in;
    // the regular transaction list remains date-based.
    const periodFilter =
      filters.invoicePeriod && invoicePeriods.length > 0
        ? {
            OR: [
              {
                invoice: {
                  OR: invoicePeriods.map(({ year, month }) => ({
                    year,
                    month,
                  })),
                },
              },
              {
                invoiceId: null,
                date: dateFilter,
              },
            ],
          }
        : { date: dateFilter };

    return await this.prisma.transaction.findMany({
      where: {
        userId,
        categoryId: filters.categoryId,
        bankId: filters.bankId,
        type: filters.type,
        parentId: filters.installmentsOnly ? { not: null } : undefined,
        ...periodFilter,
      },
      include: {
        // `isArchived` acompanha para o formulário de edição poder exibir
        // "— Arquivado" no banco atual sem uma consulta extra.
        bank: {
          select: {
            id: true,
            name: true,
            isSystem: true,
            isArchived: true,
          },
        },
        category: { select: { id: true, name: true, color: true, icon: true } },
        person: { select: { id: true, name: true } },
        invoice: {
          select: { id: true, month: true, year: true, status: true },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  private getInvoicePeriods(
    startDate?: string,
    endDate?: string,
  ): Array<{ year: number; month: number }> {
    const start = startDate?.slice(0, 10).split('-').map(Number);
    const end = endDate?.slice(0, 10).split('-').map(Number);

    if (!start || start.length !== 3 || !end || end.length !== 3) {
      return [];
    }

    const periods: Array<{ year: number; month: number }> = [];
    const cursor = new Date(Date.UTC(start[0], start[1] - 1, 1));
    const last = new Date(Date.UTC(end[0], end[1] - 1, 1));

    while (cursor <= last) {
      periods.push({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return periods;
  }

  /**
   * ATENÇÃO — `dto.amount` aqui é o valor DE UMA PARCELA, não o total da
   * compra. É deliberadamente diferente do `create`, onde o mesmo campo
   * representa o total a ser rateado.
   *
   * O motivo é compatibilidade: o update aplica o valor a cada transação do
   * escopo (ONE/NEXT/ALL), e séries antigas foram cadastradas parcela a
   * parcela. Tratar `amount` como total aqui reinterpretaria esses registros
   * e alteraria retroativamente o passivo do usuário.
   *
   * Unificar as duas semânticas exige decisão de produto sobre o histórico —
   * ver a entrega da Fase 5A.
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateTransactionDto,
    scope?: string,
  ) {
    const existingTransaction =
      await this.entityValidationService.validateTransaction(id, userId);

    /* A MESMA autoridade do delete: lineage, não cardinalidade atual. */
    const isInstallment = belongsToInstallmentSeries(existingTransaction);

    // A data representa quando a compra parcelada aconteceu — é a mesma para
    // toda a série, então editá-la sempre afeta todas as parcelas de uma vez,
    // independente do scope escolhido para os demais campos. O frontend sempre
    // envia `date` no payload (mesmo sem alteração), então só tratamos como
    // "editando a data" quando o valor de fato mudou.
    const editingInstallmentDate =
      isInstallment &&
      Boolean(dto.date) &&
      parseDateOnly(dto.date as string).getTime() !==
        existingTransaction.date.getTime();
    const normalizedScope = editingInstallmentDate
      ? 'ALL'
      : this.normalizeScope(scope);

    if (isInstallment) {
      dto.title = undefined;
    }

    // Lançamento gerado por assinatura tem categoria fixa: ela identifica a
    // origem no extrato e é a mesma para toda a série. Ignorar o campo em vez
    // de recusar a edição deixa os demais (valor, data, descrição) passarem.
    if (existingTransaction.subscriptionId) {
      dto.categoryId = undefined;
    }

    // Antes de qualquer escrita: uma compra cujo recebível já foi recebido não
    // pode ter os dados financeiros alterados por aqui.
    await this.assertNoPaidReceivableAffected(
      existingTransaction,
      userId,
      dto,
      normalizedScope,
    );

    /**
     * E a transação que COMPROVA uma quitação também não.
     *
     * A guarda existia só na exclusão, e o dano da edição era idêntico: a
     * dívida continuava paga apontando para um comprovante de outro valor.
     * A checagem só roda quando algum fato financeiro muda — corrigir o
     * título ou a categoria de um pagamento continua permitido.
     */
    if (this.changesPaymentFacts(dto, existingTransaction)) {
      await this.assertNotAPaymentTransaction(
        [existingTransaction],
        userId,
        this.prisma,
        'update',
      );
    }

    if (editingInstallmentDate) {
      await this.assertInvoiceReassignmentAllowed(
        existingTransaction,
        userId,
        dto,
      );
    }
    delete dto.confirmReopenClosedInvoice;

    if (dto.bankId && dto.bankId !== existingTransaction.bankId) {
      await this.entityValidationService.validateBank(dto.bankId, userId);
    }

    if (dto.categoryId && dto.categoryId !== existingTransaction.categoryId) {
      await this.entityValidationService.validateCategory(
        dto.categoryId,
        userId,
      );
    }

    const effectiveType = dto.type ?? existingTransaction.type;
    const personIdProvided = dto.personId !== undefined;

    if (
      personIdProvided &&
      dto.personId !== null &&
      effectiveType !== 'CREDIT_CARD'
    ) {
      throw new BadRequestException(
        'Só é possível vincular uma pessoa a transações de cartão de crédito',
      );
    }

    // Estorno + pessoa é recusado, mas sem reescrever histórico: um registro
    // legado que já tem a combinação continua editável no que é descritivo. O
    // bloqueio vale para EDIÇÃO FINANCEIRA que mantenha ou introduza o par —
    // e remover a pessoa é sempre um caminho válido de saída.
    const effectiveIsRefund = dto.isRefund ?? existingTransaction.isRefund;
    const effectivePersonId = personIdProvided
      ? dto.personId
      : existingTransaction.personId;
    const alreadyLegacy = isRefundWithPerson(
      existingTransaction.isRefund,
      existingTransaction.personId,
    );
    const introducesCombination =
      isRefundWithPerson(effectiveIsRefund, effectivePersonId) &&
      // Um legado que permanece exatamente como estava não é "introduzir".
      !(alreadyLegacy && dto.isRefund === undefined && !personIdProvided);

    if (introducesCombination) {
      assertRefundHasNoPerson(effectiveIsRefund, effectivePersonId);
    }

    let newPerson: Person | null = null;
    if (dto.personId) {
      newPerson = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // `normalizedScope` já virou 'ALL' se a data mudou — não há caminho
        // alternativo de seleção, para a prévia não divergir do save.
        const transactionsToUpdate = await this.getTransactionsByScope(
          tx,
          existingTransaction,
          userId,
          normalizedScope,
        );
        const updatedTransactions: Transaction[] = [];
        let bank: Bank | null = null;
        let installmentBaseDate: Date | null = null;

        if (editingInstallmentDate) {
          installmentBaseDate = parseDateOnly(dto.date as string);
        } else if (existingTransaction.parentId) {
          const parentTransaction = await tx.transaction.findUnique({
            where: { id: existingTransaction.parentId, userId },
            select: { date: true },
          });
          installmentBaseDate = parentTransaction?.date ?? null;
        }

        if (
          dto.type === 'CREDIT_CARD' ||
          existingTransaction.type === 'CREDIT_CARD'
        ) {
          // A troca para outro banco já foi validada acima, com a recusa de
          // arquivado. Aqui só se relê o calendário de fatura, e a transação
          // pode legitimamente já morar num banco arquivado — corrigir uma
          // compra antiga de um cartão encerrado tem de continuar possível.
          bank = await this.entityValidationService.validateBank(
            dto.bankId ?? existingTransaction.bankId,
            userId,
            { allowArchived: true },
          );
        }

        for (const transaction of transactionsToUpdate) {
          const bankId = dto.bankId ?? transaction.bankId;
          const type = dto.type ?? transaction.type;
          const amount = dto.amount ?? Number(transaction.amount);
          const isRefund = dto.isRefund ?? transaction.isRefund;
          const installmentIndex = this.getInstallmentIndex(transaction);
          const date =
            installmentIndex !== null && installmentBaseDate
              ? installmentBaseDate
              : dto.date
                ? parseDateOnly(dto.date)
                : transaction.date;

          if (isRefund && type !== 'CREDIT_CARD') {
            throw new BadRequestException(
              'Reembolsos devem ser transações de cartão de crédito',
            );
          }

          const invoiceRelevantChanged =
            type !== transaction.type ||
            bankId !== transaction.bankId ||
            amount !== Number(transaction.amount) ||
            isRefund !== transaction.isRefund ||
            date.getTime() !== transaction.date.getTime();

          let invoiceId = transaction.invoiceId;

          if (invoiceRelevantChanged) {
            if (transaction.invoiceId) {
              const { status } = await tx.invoice.findUniqueOrThrow({
                where: { id: transaction.invoiceId, userId },
                select: { status: true },
              });

              if (status === 'PAID') {
                throw new ForbiddenException(
                  'Não é possível alterar uma transação de fatura paga',
                );
              }

              const previousInvoice = await tx.invoice.update({
                where: { id: transaction.invoiceId, userId },
                data: {
                  totalAmount: transaction.isRefund
                    ? { increment: transaction.amount }
                    : { decrement: transaction.amount },
                },
              });

              /*
                A fatura que ficou vazia sai junto.

                `remove` sempre fez isso; a reatribuição decrementava e parava
                ali. Mover a ÚNICA transação de uma fatura para outro banco
                deixava atrás um ciclo de R$ 0,00 sem lançamento nenhum — que
                continua sendo listado, ganha status pelo cron e aparece na
                visão mensal como se aquele mês tivesse tido fatura.

                O mesmo predicado das outras limpezas: zero é o sinal de que
                não sobrou lançamento. Faturas com saldo, mesmo menor, ficam.
              */
              await deleteInvoiceIfEmpty(tx, userId, previousInvoice);
            }

            invoiceId = null;

            if (type === 'CREDIT_CARD') {
              const schedule = {
                invoiceDueDate: bank!.invoiceDueDate,
                invoiceDueDaysAfterClose: bank!.invoiceDueDaysAfterClose,
              };
              let invoice: Invoice;

              if (installmentIndex !== null && installmentBaseDate) {
                const firstPeriod = getInvoicePeriodForDate(
                  schedule,
                  installmentBaseDate,
                );
                const period = offsetInvoicePeriod(
                  firstPeriod.year,
                  firstPeriod.month,
                  installmentIndex,
                );
                invoice = await findOrCreateInvoiceForPeriod(
                  tx,
                  userId,
                  bankId,
                  schedule,
                  period.year,
                  period.month,
                );
              } else {
                invoice = await findOrCreateInvoice(
                  tx,
                  userId,
                  bankId,
                  bank!.invoiceDueDate,
                  bank!.invoiceDueDaysAfterClose,
                  date,
                );
              }

              invoiceId = invoice.id;
            }

            if (invoiceId) {
              await tx.invoice.update({
                where: { id: invoiceId, userId },
                data: {
                  totalAmount: isRefund
                    ? { decrement: amount }
                    : { increment: amount },
                },
              });
            }
          }

          // Campos explícitos em vez de espalhar o DTO: o corpo da requisição
          // é entrada externa, e `confirmReopenClosedInvoice` é um sinal de
          // protocolo que não existe como coluna. `undefined` faz o Prisma
          // ignorar o campo; `personId: null` continua desvinculando a pessoa,
          // por isso a distinção entre "não enviado" e "enviado como null".
          const updatedTransaction = await tx.transaction.update({
            where: { id: transaction.id, userId },
            data: {
              bankId: dto.bankId,
              categoryId: dto.categoryId,
              title: dto.title,
              type: dto.type,
              amount: dto.amount,
              isRefund: dto.isRefund,
              description: dto.description,
              personId: personIdProvided ? (dto.personId ?? null) : undefined,
              invoiceId,
              date,
            },
          });

          await this.syncLinkedReceivable(
            tx,
            userId,
            transaction,
            updatedTransaction,
            bank,
            personIdProvided,
            dto.personId,
            newPerson,
          );

          updatedTransactions.push(updatedTransaction);
        }

        return normalizedScope === 'ONE'
          ? updatedTransactions[0]
          : updatedTransactions;
      },
    );
  }

  /**
   * Os fatos que decidem quais parcelas sobrevivem — em quatro consultas.
   *
   * Uma consulta por parcela seria N+1 numa série de dez. Cada uma destas
   * pergunta por CONJUNTO e devolve ids, que o plano puro depois cruza.
   *
   * Recebe o cliente Prisma de fora para servir aos dois chamadores: a prévia
   * lê fora de transação, a execução lê DENTRO dela — e é essa leitura de
   * dentro que garante que o plano executado reflete o estado no momento da
   * escrita, não o de quando a tela foi montada.
   */
  private async collectProtectionFacts(
    tx: Prisma.TransactionClient | PrismaService,
    series: InstallmentCandidate[],
    userId: string,
  ): Promise<{
    facts: InstallmentProtectionFacts;
    invoiceTotals: Map<string, number>;
  }> {
    const transactionIds = series.map((transaction) => transaction.id);
    const invoiceIds = [
      ...new Set(
        series
          .map((transaction) => transaction.invoiceId)
          .filter((invoiceId): invoiceId is string => invoiceId !== null),
      ),
    ];

    const [invoices, receivables, paidDebts, paidReceivables] =
      await Promise.all([
        invoiceIds.length
          ? tx.invoice.findMany({
              where: { id: { in: invoiceIds }, userId },
              select: { id: true, status: true, totalAmount: true },
            })
          : Promise.resolve(
              [] as { id: string; status: string; totalAmount: unknown }[],
            ),
        tx.receivable.findMany({
          where: { userId, transactionId: { in: transactionIds } },
          select: { transactionId: true, isPaid: true },
        }),
        tx.debt.findMany({
          where: { userId, paymentTransactionId: { in: transactionIds } },
          select: { paymentTransactionId: true },
        }),
        tx.receivable.findMany({
          where: { userId, paymentTransactionId: { in: transactionIds } },
          select: { paymentTransactionId: true },
        }),
      ]);

    const paidInvoiceIds = new Set(
      invoices
        .filter((invoice) => invoice.status === 'PAID')
        .map((invoice) => invoice.id),
    );

    const invoiceTotals = new Map(
      invoices.map((invoice) => [invoice.id, Number(invoice.totalAmount)]),
    );

    const receivedReceivableSourceIds = new Set(
      receivables
        .filter((receivable) => receivable.isPaid && receivable.transactionId)
        .map((receivable) => receivable.transactionId as string),
    );

    const pendingReceivableSourceIds = new Set(
      receivables
        .filter((receivable) => !receivable.isPaid && receivable.transactionId)
        .map((receivable) => receivable.transactionId as string),
    );

    const paymentTransactionIds = new Set(
      [...paidDebts, ...paidReceivables]
        .map((registro) => registro.paymentTransactionId)
        .filter((identificador): identificador is string =>
          Boolean(identificador),
        ),
    );

    return {
      facts: {
        paidInvoiceIds,
        receivedReceivableSourceIds,
        paymentTransactionIds,
        pendingReceivableSourceIds,
      },
      invoiceTotals,
    };
  }

  /**
   * O plano de exclusão da série a que esta transação pertence.
   *
   * Fonte ÚNICA da prévia e da execução. Duas implementações da mesma regra
   * divergiriam, e o sintoma seria a tela prometer uma coisa e o servidor
   * fazer outra — exatamente o que esta fase existe para eliminar.
   */
  private async resolveInstallmentDeletePlan(
    tx: Prisma.TransactionClient | PrismaService,
    transaction: Transaction,
    userId: string,
  ): Promise<InstallmentDeletePlan> {
    const series = await this.getInstallmentSeries(tx, transaction, userId);
    const { facts, invoiceTotals } = await this.collectProtectionFacts(
      tx,
      series,
      userId,
    );

    return buildInstallmentDeletePlan(series, facts, invoiceTotals);
  }

  /** O que a exclusão faria — sem gravar nada. */
  async previewDelete(
    id: string,
    userId: string,
  ): Promise<TransactionDeletePreview> {
    const existing = await this.entityValidationService.validateTransaction(
      id,
      userId,
    );

    /*
      LINEAGE, não cardinalidade: `hasInstallmentChildren` contava filhas que
      AINDA existem, e a primeira parcela é a raiz — bastava excluir as irmãs
      para a série deixar de ser reconhecida. A prévia dizia
      `isInstallment: false` e entregava 1 parcela deletável ao mesmo tempo.
    */
    const isInstallment = belongsToInstallmentSeries(existing);

    const plan = await this.resolveInstallmentDeletePlan(
      this.prisma,
      existing,
      userId,
    );

    return serializeDeletePlan(plan, isInstallment);
  }

  /**
   * Exclui as parcelas em aberto da série — e só elas.
   *
   * ── Por que não passa pelos guards do `remove` legado ──
   *
   * Aqueles são all-or-nothing por desenho: qualquer parcela protegida
   * derruba a operação inteira. Faz sentido para `ALL`, que promete apagar a
   * série toda e não pode cumprir pela metade. Aqui a promessa é outra —
   * "remova o que ainda dá" — e uma parcela protegida é RESULTADO ESPERADO,
   * não erro.
   *
   * A política é a mesma; o que muda é a granularidade: `resolvePreservationReason`
   * responde por transação em vez de por conjunto.
   */
  private async removeOpenInstallments(
    id: string,
    userId: string,
    expectedDeletableIds?: string[],
  ): Promise<TransactionDeleteResult> {
    const existing = await this.entityValidationService.validateTransaction(
      id,
      userId,
    );

    /*
      A MESMA autoridade da prévia. Antes eram dois predicates equivalentes
      por coincidência, e a survivor de uma exclusão parcial caía no lado
      errado dos dois — mas a UI, que lê o título, continuava oferecendo o
      fluxo de parcelas.
    */
    const isInstallment = belongsToInstallmentSeries(existing);

    if (!isInstallment) {
      /*
        Compra à vista não tem "parcelas em aberto". Apagá-la como se `OPEN`
        fosse `ONE` executaria uma operação que ninguém pediu — a tela usa o
        fluxo simples para este caso.
      */
      throw new BadRequestException({
        message:
          'Esta transação não é uma compra parcelada. Use a exclusão simples.',
        code: 'OPEN_SCOPE_REQUIRES_INSTALLMENT',
      });
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        /*
          Recalculado DENTRO da transação: entre a prévia e este instante a
          fatura pode ter sido paga ou a cobrança recebida. A prévia informa;
          quem decide é esta leitura.
        */
        const plan = await this.resolveInstallmentDeletePlan(
          tx,
          existing,
          userId,
        );

        const deletableIds = plan.deletable.map((item) => item.id);

        /*
          As duas recusas abaixo carregam o plano que as causou.

          Sem ele o cliente precisaria de uma segunda requisição para saber o
          que mudou — e essa leitura poderia devolver um terceiro estado,
          explicando a recusa por algo que não a causou. O plano já está aqui,
          calculado dentro da transação: serializá-lo custa nada e é a única
          resposta que corresponde ao motivo real.
        */
        if (deletableIds.length === 0) {
          throw new ConflictException({
            message:
              'Não há parcelas em aberto que possam ser excluídas nesta compra.',
            code: 'NO_DELETABLE_INSTALLMENTS',
            preview: serializeDeletePlan(plan, true),
          });
        }

        /*
          O usuário confirmou um conjunto específico. Se ele mudou, a
          confirmação não vale mais para o conjunto novo — devolvemos o
          estado atual e deixamos a decisão com quem pediu.

          A comparação é por identidade, não por contagem: trocar uma parcela
          por outra mantém o total e mudaria o que é apagado.
        */
        if (
          expectedDeletableIds &&
          deletableSetChanged(expectedDeletableIds, deletableIds)
        ) {
          throw new ConflictException({
            message:
              'O que pode ser excluído mudou desde a última verificação. Confira novamente antes de confirmar.',
            code: 'DELETE_SET_CHANGED',
            preview: serializeDeletePlan(plan, true),
          });
        }

        /*
          Mesma ordem do `remove` legado: a cobrança derivada primeiro, depois
          a transação, depois a fatura. O FK de `Receivable.transactionId` é
          ON DELETE SET NULL — apagar a transação antes zeraria o vínculo e a
          cobrança sobreviveria órfã.
        */
        for (const item of plan.deletable) {
          await tx.receivable.deleteMany({
            where: { transactionId: item.id, userId },
          });

          await tx.transaction.delete({ where: { id: item.id, userId } });

          if (item.invoiceId) {
            const invoice = await tx.invoice.update({
              where: { id: item.invoiceId, userId },
              data: { totalAmount: { decrement: item.amount as never } },
            });

            await deleteInvoiceIfEmpty(tx, userId, invoice);
          }
        }

        return {
          deletedIds: deletableIds,
          deletedCount: deletableIds.length,
          preservedIds: plan.preserved.map(({ transaction: item }) => item.id),
          receivablesRemoved: plan.receivablesRemoved,
          invoicesEmptied: plan.invoicesEmptied.length,
        };
      },
    );
  }

  /**
   * `OPEN` devolve o conjunto real removido; os escopos legados seguem sem
   * retorno, como sempre foram. A união é honesta sobre isso — quem chama com
   * `OPEN` precisa saber o que saiu para decidir se o painel aberto sumiu.
   */
  async remove(
    id: string,
    userId: string,
    scope?: string,
    expectedDeletableIds?: string[],
  ): Promise<TransactionDeleteResult | void> {
    /*
      `OPEN` não é um escopo a mais na mesma máquina: ele particiona a série
      em vez de recortá-la. Roteado antes de `normalizeScope`, que o recusa.
    */
    if (scope === 'OPEN') {
      return await this.removeOpenInstallments(
        id,
        userId,
        expectedDeletableIds,
      );
    }

    const existing = await this.entityValidationService.validateTransaction(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const transactionsToDelete = await this.getTransactionsByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        // Excluir de uma fatura paga alteraria o total de algo já quitado —
        // mesma razão que impede criar e editar nesse estado.
        const invoiceIds = [
          ...new Set(
            transactionsToDelete
              .map((transaction) => transaction.invoiceId)
              .filter((invoiceId): invoiceId is string => invoiceId !== null),
          ),
        ];
        if (invoiceIds.length > 0) {
          const paid = await tx.invoice.findFirst({
            where: { id: { in: invoiceIds }, userId, status: 'PAID' },
            select: { id: true },
          });
          if (paid) {
            throw new ForbiddenException(
              'Não é possível excluir: a transação pertence a uma fatura já paga',
            );
          }
        }

        // A cascata abaixo apaga o recebível vinculado; se ele já foi recebido,
        // isso deixaria a transação de recebimento sem origem.
        await this.assertNoPaidReceivableDeleted(
          transactionsToDelete,
          userId,
          tx,
        );

        // Uma transação também pode SER o pagamento de uma dívida ou de um
        // recebível. O FK é ON DELETE SET NULL, então apagá-la por aqui não dá
        // erro: apenas zera o vínculo e deixa o registro marcado como pago sem
        // nada que comprove o pagamento. Desfazer o pagamento é o caminho
        // correto — ele existe na tela de Dívidas e A Receber e limpa `isPaid`
        // junto.
        await this.assertNotAPaymentTransaction(
          transactionsToDelete,
          userId,
          tx,
        );

        for (const transaction of transactionsToDelete) {
          await tx.receivable.deleteMany({
            where: { transactionId: transaction.id, userId },
          });

          await tx.transaction.delete({
            where: { id: transaction.id, userId },
          });

          if (transaction.invoiceId) {
            const invoice = await tx.invoice.update({
              where: { id: transaction.invoiceId, userId },
              data: {
                totalAmount: transaction.isRefund
                  ? { increment: transaction.amount }
                  : { decrement: transaction.amount },
              },
            });

            await deleteInvoiceIfEmpty(tx, userId, invoice);
          }
        }

        return;
      },
    );
  }

  /**
   * O escopo clássico, para edição e para a exclusão legada.
   *
   * `OPEN` é recusado em vez de cair no `ONE` do fallback. Silenciar aqui
   * seria o pior desfecho possível: quem pedisse "exclua as parcelas em
   * aberto" teria UMA parcela apagada e receberia sucesso — uma operação
   * diferente da pedida, apresentada como se fosse a pedida.
   */
  private normalizeScope(scope?: string): TransactionScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    if (scope === 'OPEN') {
      throw new BadRequestException({
        message:
          'O escopo OPEN só existe para excluir as parcelas em aberto de uma compra parcelada.',
        code: 'OPEN_SCOPE_NOT_SUPPORTED',
      });
    }

    return 'ONE';
  }

  /**
   * Transações que um escopo alcança — fonte única para update, prévia e
   * exclusão.
   *
   * `ONE` é só a transação escolhida. `NEXT` é ela e as posteriores da série.
   * `ALL` é a série inteira, INCLUSIVE a raiz, independente de onde a ação
   * começou.
   *
   * A versão anterior filtrava por `parentId: transaction.parentId`. Como a
   * raiz tem `parentId = null`, ela nunca entrava no resultado: `ALL` a partir
   * de 2/3 alterava 2 e 3 e deixava a primeira parcela intacta. Pior, quem
   * começasse pela própria raiz recebia só ela em qualquer escopo. A seleção
   * agora usa a identidade da série (`parentId ?? id`), que é a mesma que
   * `getInstallmentSeries` sempre usou — a lógica correta existia ao lado.
   */
  private async getTransactionsByScope(
    tx: Prisma.TransactionClient | PrismaService,
    transaction: Transaction,
    userId: string,
    scope: TransactionScope,
  ): Promise<Transaction[]> {
    if (scope === 'ONE') return [transaction];

    const series = await this.getInstallmentSeries(tx, transaction, userId);

    // Sem série (compra à vista), qualquer escopo é a própria transação.
    if (series.length <= 1) return [transaction];

    if (scope === 'ALL') return series;

    // NEXT: desta parcela em diante, na ordem da série.
    const currentIndex = series.findIndex((item) => item.id === transaction.id);
    return currentIndex >= 0 ? series.slice(currentIndex) : [transaction];
  }

  private getInstallmentIndex(transaction: Transaction): number | null {
    const match = transaction.title.match(/\s(\d+)\/\d+$/);
    if (!match) return null;
    return Math.max(0, Number(match[1]) - 1);
  }

  /**
   * Todos os membros da série, em ordem de parcela.
   *
   * A identidade é estrutural — `parentId ?? id` —, não o título. A ordenação
   * usa o número da parcela quando o título o traz, com `createdAt` como
   * desempate: a criação grava as parcelas em sequência, mas duas podem
   * compartilhar o mesmo timestamp, e aí `NEXT` precisaria de um critério
   * estável. A dependência do título fica contida aqui, sem se espalhar.
   */
  private async getInstallmentSeries(
    tx: Prisma.TransactionClient | PrismaService,
    transaction: Transaction,
    userId: string,
  ): Promise<Transaction[]> {
    const seriesRootId = transaction.parentId ?? transaction.id;
    const series = await tx.transaction.findMany({
      where: {
        userId,
        OR: [{ id: seriesRootId }, { parentId: seriesRootId }],
      },
      orderBy: { createdAt: 'asc' },
    });

    return series.sort((a, b) => {
      const indexA = this.getInstallmentIndex(a);
      const indexB = this.getInstallmentIndex(b);
      if (indexA !== null && indexB !== null && indexA !== indexB) {
        return indexA - indexB;
      }
      // Raiz primeiro quando os títulos não numeram as parcelas.
      if (a.id === seriesRootId) return -1;
      if (b.id === seriesRootId) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * Editar a data de uma compra parcelada pode mover parcelas para outra
   * fatura. Bloqueia se qualquer fatura afetada já estiver PAID; se alguma
   * estiver CLOSED, exige confirmação explícita do usuário antes de aplicar.
   */
  private async assertInvoiceReassignmentAllowed(
    existingTransaction: Transaction,
    userId: string,
    dto: UpdateTransactionDto,
  ): Promise<void> {
    if (existingTransaction.type !== 'CREDIT_CARD') return;

    // Só lê o calendário para saber em que fatura a transação cairia. A
    // recusa de mover para um banco arquivado é feita antes, na guarda de
    // troca de banco; repeti-la aqui trocaria aquela mensagem por esta.
    const bank = await this.entityValidationService.validateBank(
      dto.bankId ?? existingTransaction.bankId,
      userId,
      { allowArchived: true },
    );
    const schedule = {
      invoiceDueDate: bank.invoiceDueDate,
      invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
    };

    const seriesTransactions = await this.getInstallmentSeries(
      this.prisma,
      existingTransaction,
      userId,
    );

    const newBaseDate = parseDateOnly(dto.date as string);
    const firstPeriod = getInvoicePeriodForDate(schedule, newBaseDate);

    const affectedInvoices = await Promise.all(
      seriesTransactions.map(async (transaction) => {
        const installmentIndex = this.getInstallmentIndex(transaction) ?? 0;
        const period = offsetInvoicePeriod(
          firstPeriod.year,
          firstPeriod.month,
          installmentIndex,
        );
        return this.prisma.invoice.findFirst({
          where: {
            userId,
            bankId: dto.bankId ?? existingTransaction.bankId,
            year: period.year,
            month: period.month,
          },
        });
      }),
    );

    const paidInvoice = affectedInvoices.find(
      (invoice) => invoice?.status === 'PAID',
    );
    if (paidInvoice) {
      throw new ForbiddenException(
        'Não é possível alterar a data: uma das faturas afetadas já está paga',
      );
    }

    const closedInvoice = affectedInvoices.find(
      (invoice) => invoice?.status === 'CLOSED',
    );
    if (closedInvoice && !dto.confirmReopenClosedInvoice) {
      throw new ConflictException({
        message:
          'Essa alteração vai mover parcelas para uma fatura já fechada. Confirme para continuar.',
        code: 'CLOSED_INVOICE_REASSIGNMENT',
      });
    }
  }

  /**
   * Um Receivable automático já recebido registra um fato consumado: existe uma
   * transação de recebimento com valor e data próprios. Deixar a compra de
   * origem ser editada livremente faria o valor devido divergir do valor
   * recebido, sem erro visível — o recebível viraria R$ 250 enquanto o
   * recebimento continuaria em R$ 300.
   *
   * A política é bloquear a edição enquanto o recebimento existir: o usuário
   * desfaz o recebimento, corrige a compra e marca como recebido de novo.
   * Mesmo espírito das salvaguardas de fatura PAID, que já são familiares.
   *
   * O que conta como financeiro (bloqueia): valor, pessoa, tipo, banco e data —
   * qualquer coisa que mude quanto se deve, quem deve, se o recebível deve
   * existir, ou de que fatura ele herda o vencimento.
   *
   * O que não conta (passa): título, descrição e categoria. São texto; nenhum
   * altera fato financeiro. O título continua sendo sincronizado com o
   * recebível, o que é desejável — corrigir "Ingresoo" para "Ingresso" deve
   * refletir na cobrança que a pessoa vê.
   */
  private async assertNoPaidReceivableAffected(
    existingTransaction: Transaction,
    userId: string,
    dto: UpdateTransactionDto,
    scope: TransactionScope,
  ): Promise<void> {
    const changesFinancials =
      (dto.amount !== undefined &&
        dto.amount !== Number(existingTransaction.amount)) ||
      (dto.personId !== undefined &&
        dto.personId !== existingTransaction.personId) ||
      (dto.type !== undefined && dto.type !== existingTransaction.type) ||
      (dto.isRefund !== undefined &&
        dto.isRefund !== existingTransaction.isRefund) ||
      (dto.bankId !== undefined && dto.bankId !== existingTransaction.bankId) ||
      (Boolean(dto.date) &&
        parseDateOnly(dto.date as string).getTime() !==
          existingTransaction.date.getTime());

    if (!changesFinancials) return;

    // Editar a data de uma parcela move a série inteira, e os chamadores já
    // forçam 'ALL' nesse caso — a verificação cobre todas as parcelas sem
    // precisar de um seletor próprio aqui.
    const affected = await this.getTransactionsByScope(
      this.prisma,
      existingTransaction,
      userId,
      scope,
    );

    const paidReceivable = await this.prisma.receivable.findFirst({
      where: {
        userId,
        isPaid: true,
        transactionId: { in: affected.map((transaction) => transaction.id) },
      },
      select: { id: true },
    });

    if (paidReceivable) {
      throw new ConflictException({
        message:
          'O valor desta compra já foi recebido. Desfaça o recebimento antes de alterar os dados financeiros da compra.',
        code: 'RECEIVABLE_ALREADY_PAID',
      });
    }
  }

  /**
   * Mesma proteção do update, aplicada à exclusão: apagar a compra apagaria em
   * cascata um recebível já recebido, deixando a transação de recebimento órfã
   * — dinheiro que entrou sem nada que explique de onde veio.
   */
  private async assertNoPaidReceivableDeleted(
    transactions: Transaction[],
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const paidReceivable = await tx.receivable.findFirst({
      where: {
        userId,
        isPaid: true,
        transactionId: {
          in: transactions.map((transaction) => transaction.id),
        },
      },
      select: { id: true },
    });

    if (paidReceivable) {
      throw new ConflictException({
        message:
          'O valor desta compra já foi recebido. Desfaça o recebimento antes de excluir a compra.',
        code: 'RECEIVABLE_ALREADY_PAID',
      });
    }
  }

  /**
   * Impede que uma transação que comprova uma quitação seja apagada ou tenha
   * seus dados financeiros alterados pelo extrato.
   *
   * ─── Exclusão ────────────────────────────────────────────────────────────
   *
   * O FK é `ON DELETE SET NULL`: o banco aceitaria a exclusão e o registro
   * relacionado ficaria `isPaid = true` apontando para nada.
   *
   * ─── Edição ──────────────────────────────────────────────────────────────
   *
   * A guarda cobria só a exclusão, e o dano pela edição era o mesmo: uma
   * dívida de R$ 500 marcada como paga podia ter a transação comprovante
   * alterada para R$ 100 pelo extrato, e a dívida continuava `isPaid = true`
   * apontando para uma prova que já não corresponde ao que foi pago.
   *
   * Só os campos FINANCEIROS são bloqueados. Título, descrição e categoria
   * passam: corrigir a categoria de um pagamento não contradiz o pagamento, e
   * é a mesma política já adotada para recebível pago e fatura fechada.
   */
  private async assertNotAPaymentTransaction(
    transactions: Transaction[],
    userId: string,
    tx: Prisma.TransactionClient,
    operation: 'delete' | 'update' = 'delete',
  ): Promise<void> {
    const ids = transactions.map((transaction) => transaction.id);

    const [debt, receivable] = await Promise.all([
      tx.debt.findFirst({
        where: { userId, paymentTransactionId: { in: ids } },
        select: { id: true },
      }),
      tx.receivable.findFirst({
        where: { userId, paymentTransactionId: { in: ids } },
        select: { id: true },
      }),
    ]);

    // O verbo muda porque a saída do usuário é diferente: quem tenta apagar
    // precisa desmarcar; quem tenta editar precisa desmarcar, corrigir e
    // marcar de novo.
    const action =
      operation === 'delete' ? 'removê-la' : 'alterar seus dados financeiros';

    if (debt) {
      throw new ConflictException({
        message: `Esta transação registra o pagamento de uma dívida. Desmarque a dívida como paga para ${action}.`,
        code: 'PAYMENT_TRANSACTION_LINKED',
      });
    }

    if (receivable) {
      throw new ConflictException({
        message: `Esta transação registra o recebimento de uma cobrança. Desmarque a cobrança como recebida para ${action}.`,
        code: 'PAYMENT_TRANSACTION_LINKED',
      });
    }
  }

  /**
   * Campos que contradizem uma quitação já registrada.
   *
   * A lista é dos fatos FINANCEIROS: valor, data, banco, forma, estorno e
   * pessoa. Fora dela ficam título, descrição e categoria — texto e
   * classificação, que não mudam o que foi pago nem quando.
   *
   * `personId` entra porque transformar o pagamento numa compra de terceiro
   * criaria uma cobrança a partir de um comprovante de quitação.
   */
  private changesPaymentFacts(
    dto: UpdateTransactionDto,
    existing: Transaction,
  ): boolean {
    if (dto.amount !== undefined && dto.amount !== Number(existing.amount)) {
      return true;
    }
    if (
      dto.date !== undefined &&
      parseDateOnly(dto.date).getTime() !== existing.date.getTime()
    ) {
      return true;
    }
    if (dto.bankId !== undefined && dto.bankId !== existing.bankId) return true;
    if (dto.type !== undefined && dto.type !== existing.type) return true;
    if (dto.isRefund !== undefined && dto.isRefund !== existing.isRefund) {
      return true;
    }
    if (dto.personId !== undefined && dto.personId !== existing.personId) {
      return true;
    }

    return false;
  }

  private async syncLinkedReceivable(
    tx: Prisma.TransactionClient,
    userId: string,
    transaction: Transaction,
    updatedTransaction: Transaction,
    bank: Bank | null,
    personIdProvided: boolean,
    dtoPersonId: string | null | undefined,
    newPerson: Person | null,
  ) {
    const existingReceivable = await tx.receivable.findUnique({
      where: { transactionId: transaction.id },
    });

    const personIdAfter = personIdProvided ? dtoPersonId : transaction.personId;
    const shouldHaveReceivable =
      Boolean(personIdAfter) &&
      updatedTransaction.type === 'CREDIT_CARD' &&
      !updatedTransaction.isRefund;

    /**
     * Registro legado com estorno E pessoa ao mesmo tempo: a combinação não é
     * mais aceita, mas o histórico não é reescrito por tabela. Salvar apenas a
     * descrição de um desses registros não deve apagar a cobrança existente —
     * seria perda silenciosa de dado. Para desfazer a combinação o usuário
     * remove a pessoa explicitamente, e aí a remoção acontece.
     */
    const legacyRefundWithPerson =
      isRefundWithPerson(transaction.isRefund, transaction.personId) &&
      !personIdProvided;

    if (existingReceivable && !shouldHaveReceivable) {
      if (legacyRefundWithPerson) return;

      await tx.receivable.delete({
        where: { id: existingReceivable.id, userId },
      });
      return;
    }

    if (!existingReceivable && shouldHaveReceivable) {
      const personForNew =
        newPerson ??
        (await this.entityValidationService.validatePerson(
          personIdAfter as string,
          userId,
        ));

      const dueDate = await this.getReceivableDueDate(
        tx,
        userId,
        updatedTransaction,
      );

      await tx.receivable.create({
        data: {
          userId,
          personId: personIdAfter as string,
          parentId: null,
          transactionId: updatedTransaction.id,
          title: updatedTransaction.title,
          debtorName: personForNew.name,
          amount: updatedTransaction.amount,
          occurredAt: updatedTransaction.date,
          dueDate,
        },
      });
      return;
    }

    if (existingReceivable && shouldHaveReceivable) {
      const personChanged =
        personIdProvided && dtoPersonId !== transaction.personId;

      const personForSync = personChanged
        ? (newPerson ??
          (await this.entityValidationService.validatePerson(
            dtoPersonId as string,
            userId,
          )))
        : null;

      // O vencimento do recebível acompanha o da fatura — é a regra central da
      // feature. Quando a edição move a compra de fatura (data ou banco), o
      // vencimento tem de mover junto, senão a cobrança fica presa ao mês
      // antigo e some do calendário e dos alertas.
      const invoiceChanged =
        updatedTransaction.invoiceId !== null &&
        updatedTransaction.invoiceId !== transaction.invoiceId;

      const dueDate = invoiceChanged
        ? await this.getReceivableDueDate(tx, userId, updatedTransaction)
        : undefined;

      await tx.receivable.update({
        where: { id: existingReceivable.id, userId },
        data: {
          amount: updatedTransaction.amount,
          title: updatedTransaction.title,
          occurredAt: updatedTransaction.date,
          personId: personForSync ? personForSync.id : undefined,
          debtorName: personForSync ? personForSync.name : undefined,
          dueDate,
        },
      });
    }
  }

  /**
   * Vencimento que um recebível deve ter: o da fatura em que a compra está.
   * O banco pode ter mudado junto com a fatura, então é lido a partir da
   * própria transação atualizada em vez de confiar no que veio do escopo.
   */
  /**
   * Vencimento que a cobrança de terceiro herda da fatura de destino.
   *
   * Lê `invoice.dueDate` direto. A versão anterior buscava o banco e
   * recalculava a data pela configuração vigente — o que fazia a cobrança
   * herdar um vencimento diferente do que a fatura exibia, se o cartão tivesse
   * sido reconfigurado no meio. Com a data persistida, os dois não podem
   * divergir, e a consulta ao banco deixou de ser necessária.
   */
  private async getReceivableDueDate(
    tx: Prisma.TransactionClient,
    userId: string,
    updatedTransaction: Transaction,
  ): Promise<Date> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: updatedTransaction.invoiceId as string, userId },
      select: { dueDate: true },
    });

    return getInvoiceDueDate(invoice);
  }
}
