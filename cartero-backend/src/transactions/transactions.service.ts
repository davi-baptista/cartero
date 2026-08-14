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
  findOrCreateInvoice,
  findOrCreateInvoiceForPeriod,
  getInvoiceDueDate,
  getInvoicePeriodForDate,
  offsetInvoicePeriod,
} from 'src/common/helpers/invoice.helper';
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
      throw new BadRequestException('Reembolsos devem ser transações de cartão de crédito');
    }

    let person: Person | null = null;
    if (dto.personId) {
      person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments =
          dto.type == 'CREDIT_CARD' && !dto.isRefund ? (dto.installments ?? 1) : 1;
        const transactions: Transaction[] = [];
        const originalDate = parseDateOnly(dto.date);
        let firstInvoicePeriod: { year: number; month: number } | null = null;

        let parentId: string | null = null;
        let receivableParentId: string | null = null;

        for (let i = 0; i < installments; i++) {
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

          const title =
            installments > 1
              ? `${dto.title} ${i + 1}/${installments}`
              : dto.title;

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
              amount: dto.amount,
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
                  ? { decrement: dto.amount }
                  : { increment: dto.amount },
              },
            });
          }

          if (dto.personId && person && invoice) {
            const dueDate = getInvoiceDueDate(bank, invoice);

            const receivable: Receivable = await tx.receivable.create({
              data: {
                userId,
                personId: dto.personId,
                parentId: receivableParentId,
                transactionId: transaction.id,
                title,
                debtorName: person.name,
                amount: dto.amount,
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

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateTransaction(id, userId);
  }

  async findAll(userId: string, filters: FindTransactionsDto = {}) {
    const dateFilter = {
      gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
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
                  OR: invoicePeriods.map(({ year, month }) => ({ year, month })),
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
        bank: { select: { id: true, name: true, isSystem: true } },
        category: { select: { id: true, name: true, color: true, icon: true } },
        person: { select: { id: true, name: true } },
        invoice: { select: { id: true, month: true, year: true, status: true } },
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

  async update(
    id: string,
    userId: string,
    dto: UpdateTransactionDto,
    scope?: string,
  ) {
    const existingTransaction =
      await this.entityValidationService.validateTransaction(id, userId);

    const isInstallment =
      existingTransaction.parentId !== null ||
      (await this.hasInstallmentChildren(existingTransaction.id, userId));

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

    let newPerson: Person | null = null;
    if (dto.personId) {
      newPerson = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const transactionsToUpdate = editingInstallmentDate
          ? await this.getInstallmentSeries(tx, existingTransaction, userId)
          : await this.getTransactionsByScope(
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
          bank = await this.entityValidationService.validateBank(
            dto.bankId ?? existingTransaction.bankId,
            userId,
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
            throw new BadRequestException('Reembolsos devem ser transações de cartão de crédito');
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

              await tx.invoice.update({
                where: { id: transaction.invoiceId, userId },
                data: {
                  totalAmount: transaction.isRefund
                    ? { increment: transaction.amount }
                    : { decrement: transaction.amount },
                },
              });
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

          const updatedTransaction = await tx.transaction.update({
            where: { id: transaction.id, userId },
                 data: {
              ...dto,
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

  async remove(id: string, userId: string, scope?: string) {
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

            if (Number(invoice.totalAmount) === 0) {
              await tx.invoice.delete({
                where: { id: invoice.id, userId },
              });
            }
          }
        }

        return;
      },
    );
  }

  private normalizeScope(scope?: string): TransactionScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    return 'ONE';
  }

  private async getTransactionsByScope(
    tx: Prisma.TransactionClient,
    transaction: Transaction,
    userId: string,
    scope: TransactionScope,
  ) {
    if (!transaction.parentId || scope === 'ONE') {
      return [transaction];
    }

    if (scope === 'NEXT') {
      const siblings = await tx.transaction.findMany({
        where: {
          userId,
          parentId: transaction.parentId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const currentIndex = siblings.findIndex(
        (sibling) => sibling.id === transaction.id,
      );
      return currentIndex >= 0 ? siblings.slice(currentIndex) : [transaction];
    }

    return await tx.transaction.findMany({
      where: {
        userId,
        parentId: transaction.parentId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  private getInstallmentIndex(transaction: Transaction): number | null {
    const match = transaction.title.match(/\s(\d+)\/\d+$/);
    if (!match) return null;
    return Math.max(0, Number(match[1]) - 1);
  }

  private async getInstallmentSeries(
    tx: Prisma.TransactionClient | PrismaService,
    transaction: Transaction,
    userId: string,
  ): Promise<Transaction[]> {
    const parentId = transaction.parentId ?? transaction.id;
    return tx.transaction.findMany({
      where: {
        userId,
        OR: [{ id: parentId }, { parentId }],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async hasInstallmentChildren(
    transactionId: string,
    userId: string,
  ): Promise<boolean> {
    const child = await this.prisma.transaction.findFirst({
      where: { userId, parentId: transactionId },
      select: { id: true },
    });
    return child !== null;
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

    const bank = await this.entityValidationService.validateBank(
      dto.bankId ?? existingTransaction.bankId,
      userId,
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

    if (existingReceivable && !shouldHaveReceivable) {
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

      const invoiceForNew = await tx.invoice.findUniqueOrThrow({
        where: { id: updatedTransaction.invoiceId as string, userId },
      });

      const dueDate = getInvoiceDueDate(bank as Bank, invoiceForNew);

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

      await tx.receivable.update({
        where: { id: existingReceivable.id, userId },
        data: {
          amount: updatedTransaction.amount,
          title: updatedTransaction.title,
          occurredAt: updatedTransaction.date,
          personId: personForSync ? personForSync.id : undefined,
          debtorName: personForSync ? personForSync.name : undefined,
        },
      });
    }
  }
}
