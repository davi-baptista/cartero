import { ForbiddenException, Injectable } from '@nestjs/common';
import { Bank, Prisma, Transaction } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from 'src/transactions/dto/create-transaction.dto';
import { FindTransactionsDto } from 'src/transactions/dto/find-transactions.dto';
import { UpdateTransactionDto } from 'src/transactions/dto/update-transaction.dto';

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

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments =
          dto.type == 'CREDIT_CARD' ? (dto.installments ?? 1) : 1;
        const transactions: Transaction[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
          let invoiceId: string | null = null;
          const installmentDate = getInstallmentDate(new Date(dto.date), i);

          if (dto.type == 'CREDIT_CARD') {
            const invoice = await this.findOrCreateInvoice(
              tx,
              userId,
              dto.bankId,
              bank.invoiceCloseDate,
              bank.invoiceDueDate,
              installmentDate,
            );

            invoiceId = invoice.id;
          }

          const transaction: Transaction = await tx.transaction.create({
            data: {
              userId,
              invoiceId,
              parentId,
              bankId: dto.bankId,
              categoryId: dto.categoryId,
              title:
                installments > 1
                  ? `${dto.title} ${i + 1}/${installments}`
                  : dto.title,
              type: dto.type,
              amount: dto.amount,
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
              data: { totalAmount: { increment: dto.amount } },
            });
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
          gte: filters.startDate ? new Date(filters.startDate) : undefined,
          lte: filters.endDate ? new Date(filters.endDate) : undefined,
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
          const date = dto.date ? new Date(dto.date) : transaction.date;

          const invoiceRelevantChanged =
            type !== transaction.type ||
            bankId !== transaction.bankId ||
            amount !== Number(transaction.amount) ||
            date.getTime() !== transaction.date.getTime();

          let invoiceId = transaction.invoiceId;

          if (invoiceRelevantChanged) {
            if (transaction.invoiceId) {
              const { status } = await tx.invoice.findUniqueOrThrow({
                where: { id: transaction.invoiceId, userId },
                select: { status: true },
              });

              if (status === 'CLOSED' || status === 'PAID') {
                throw new ForbiddenException(
                  'Não é possível alterar uma transação de fatura fechada ou paga',
                );
              }

              await tx.invoice.update({
                where: { id: transaction.invoiceId, userId },
                data: {
                  totalAmount: { decrement: transaction.amount },
                },
              });
            }

            invoiceId = null;

            if (type === 'CREDIT_CARD') {
              const invoice = await this.findOrCreateInvoice(
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
                  totalAmount: { increment: amount },
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
          await tx.transaction.delete({
            where: { id: transaction.id, userId },
          });

          if (transaction.invoiceId) {
            const invoice = await tx.invoice.update({
              where: { id: transaction.invoiceId, userId },
              data: {
                totalAmount: { decrement: transaction.amount },
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

  private async findOrCreateInvoice(
    tx: Prisma.TransactionClient,
    userId: string,
    bankId: string,
    invoiceCloseDate: number,
    invoiceDueDate: number,
    transactionDate: Date,
  ) {
    let month = transactionDate.getUTCMonth() + 1;
    let year = transactionDate.getUTCFullYear();

    if (transactionDate.getUTCDate() >= invoiceCloseDate) {
      month = (month % 12) + 1;
      if (month === 1) {
        year += 1;
      }
    }

    let invoice = await tx.invoice.findFirst({
      where: {
        userId,
        bankId,
        month,
        year,
      },
    });

    if (!invoice) {
      const today = new Date();
      const closeDate = new Date(year, month, invoiceCloseDate);
      const dueDate = new Date(year, month, invoiceDueDate);

      const status =
        today > dueDate ? 'OVERDUE' : today >= closeDate ? 'CLOSED' : 'OPEN';

      invoice = await tx.invoice.create({
        data: {
          userId,
          bankId,
          month,
          year,
          status,
        },
      });
    }

    return invoice;
  }
}
