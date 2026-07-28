import {
  BadRequestException,
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
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import {
  findOrCreateInvoice,
  getInvoiceDueDate,
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

        let parentId: string | null = null;
        let receivableParentId: string | null = null;

        for (let i = 0; i < installments; i++) {
          let invoiceId: string | null = null;
          let invoice: Invoice | null = null;
          const installmentDate = getInstallmentDate(parseDateOnly(dto.date), i);

          if (dto.type == 'CREDIT_CARD') {
            invoice = await findOrCreateInvoice(
              tx,
              userId,
              dto.bankId,
              bank.invoiceCloseDate,
              bank.invoiceDueDate,
              installmentDate,
            );

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

            await tx.transaction.update({
              where: { id: transaction.id, userId },
              data: { parentId },
            });

            transaction.parentId = parentId;
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
                dueDate,
              },
            });

            if (i === 0 && installments > 1) {
              receivableParentId = receivable.id;

              await tx.receivable.update({
                where: { id: receivable.id, userId },
                data: { parentId: receivableParentId },
              });
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
    return await this.prisma.transaction.findMany({
      where: {
        userId,
        categoryId: filters.categoryId,
        bankId: filters.bankId,
        type: filters.type,
        date: {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
        },
      },
      include: {
        bank: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true, icon: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateTransactionDto,
    scope?: string,
  ) {
    const existingTransaction =
      await this.entityValidationService.validateTransaction(id, userId);
    const normalizedScope = this.normalizeScope(scope);

    if (existingTransaction.parentId && dto.date) {
      dto.date = undefined;
      dto.title = undefined;
    }

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
        const transactionsToUpdate = await this.getTransactionsByScope(
          tx,
          existingTransaction,
          userId,
          normalizedScope,
        );
        const updatedTransactions: Transaction[] = [];
        let bank: Bank | null = null;

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
          const date = dto.date ? parseDateOnly(dto.date) : transaction.date;

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
              const invoice = await findOrCreateInvoice(
                tx,
                userId,
                bankId,
                bank!.invoiceCloseDate,
                bank!.invoiceDueDate,
                date,
              );

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
      return await tx.transaction.findMany({
        where: {
          userId,
          parentId: transaction.parentId,
          date: {
            gte: transaction.date,
          },
        },
        orderBy: {
          date: 'asc',
        },
      });
    }

    return await tx.transaction.findMany({
      where: {
        userId,
        parentId: transaction.parentId,
      },
      orderBy: {
        date: 'asc',
      },
    });
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
          personId: personForSync ? personForSync.id : undefined,
          debtorName: personForSync ? personForSync.name : undefined,
        },
      });
    }
  }
}
