import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Receivable, TransactionType } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import {
  findOrCreateInvoice,
  findOrCreateSystemReceivableBank,
} from 'src/common/helpers/invoice.helper';
import { parseDateFilterEnd, parseDateFilterStart, parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  RECEIVABLE_RECEIVED_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { FindReceivablesDto } from './dto/find-receivables.dto';

type ReceivableScope = 'ONE' | 'NEXT' | 'ALL';

@Injectable()
export class ReceivablesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateReceivableDto) {
    let debtorName: string;

    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      debtorName = person.name;
    } else if (dto.debtorName) {
      debtorName = dto.debtorName;
    } else {
      throw new BadRequestException('Informe debtorName ou personId');
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments = dto.installments ? dto.installments : 1;
        const receivables: Receivable[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
            const installmentDate = getInstallmentDate(parseDateOnly(dto.dueDate), i);

          const receivable: Receivable = await tx.receivable.create({
            data: {
              userId,
              parentId,
              title:
                installments > 1
                  ? `${dto.title} ${i + 1}/${installments}`
                  : dto.title,
              debtorName,
              personId: dto.personId,
              amount: dto.amount,
              description: dto.description,
              dueDate: installmentDate,
            },
          });

          if (i === 0 && installments > 1) {
            parentId = receivable.id;

            await tx.receivable.update({
              where: { id: receivable.id, userId },
              data: { parentId },
            });

            receivable.parentId = parentId;
          }
          receivables.push(receivable);
        }
        return receivables;
      },
    );
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateReceivable(id, userId);
  }

  async findAll(userId: string, filters: FindReceivablesDto = {}) {
    return await this.prisma.receivable.findMany({
      where: {
        userId,
        debtorName: filters.debtorName,
        personId: filters.personId,
        dueDate: {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
        },
      },
      include: { person: true },
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateReceivableDto,
    scope?: string,
  ) {
    const existing = await this.entityValidationService.validateReceivable(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    let debtorName = dto.debtorName;
    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      debtorName = person.name;
    }

    const markingAsReceived = dto.isPaid === true;

    if (markingAsReceived && !dto.paymentType) {
      throw new BadRequestException(
        'Informe paymentBankId e paymentType para marcar a cobrança como recebida',
      );
    }

    const paymentBank = markingAsReceived && dto.paymentBankId
      ? await this.entityValidationService.validateBank(
          dto.paymentBankId,
          userId,
        )
      : null;

    const { paymentBankId, paymentType, ...receivableDto } = dto;
    const { title: _title, dueDate: _dueDate, ...installmentSafeDto } = receivableDto;

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const receivablesToUpdate = await this.getReceivablesByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );
        const updatedReceivables: Receivable[] = [];
        const receivableBank = markingAsReceived
          ? paymentBank ?? (await findOrCreateSystemReceivableBank(tx, userId))
          : null;

        for (const receivable of receivablesToUpdate) {
          const paidAt =
            dto.isPaid === true && !receivable.isPaid
              ? new Date()
              : dto.isPaid === false && receivable.isPaid
                ? null
                : undefined;

          let paymentTransactionId = receivable.paymentTransactionId;

          if (
            paidAt !== undefined &&
            paidAt !== null &&
            !receivable.paymentTransactionId
          ) {
            const category =
              await this.entityValidationService.findOrCreateSystemCategory(
                tx,
                userId,
                RECEIVABLE_RECEIVED_CATEGORY_NAME,
                SYSTEM_CATEGORY_ICON,
                RECEIVABLE_RECEIVED_CATEGORY_COLOR,
              );

            let invoiceId: string | null = null;
            if (paymentType === TransactionType.CREDIT_CARD && paymentBank) {
              const invoice = await findOrCreateInvoice(
                tx,
                userId,
                paymentBank.id,
                paymentBank.invoiceDueDate,
                paymentBank.invoiceDueDaysAfterClose,
                paidAt,
              );
              invoiceId = invoice.id;
            }

            const paymentTransaction = await tx.transaction.create({
              data: {
                userId,
                bankId: receivableBank!.id,
                categoryId: category.id,
                invoiceId,
                title: receivable.title,
                type: TransactionType.INCOME, // forced regardless of paymentType
                amount: receivable.amount,
                date: paidAt,
              },
            });

            if (invoiceId) {
              await tx.invoice.update({
                where: { id: invoiceId, userId },
                data: { totalAmount: { increment: receivable.amount } },
              });
            }

            paymentTransactionId = paymentTransaction.id;
          } else if (paidAt === null && receivable.paymentTransactionId) {
            const paymentTransaction = await tx.transaction.findUnique({
              where: { id: receivable.paymentTransactionId, userId },
            });

            await tx.receivable.update({
              where: { id: receivable.id, userId },
              data: { paymentTransactionId: null },
            });

            if (paymentTransaction) {
              await tx.transaction.delete({
                where: { id: paymentTransaction.id, userId },
              });

              if (paymentTransaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: paymentTransaction.invoiceId, userId },
                  data: {
                    totalAmount: { decrement: paymentTransaction.amount },
                  },
                });

                if (Number(invoice.totalAmount) === 0) {
                  await tx.invoice.delete({
                    where: { id: invoice.id, userId },
                  });
                }
              }
            }

            paymentTransactionId = null;
          }

            const updatedReceivable = await tx.receivable.update({
            where: { id: receivable.id, userId },
            data: {
              ...(existing.parentId ? installmentSafeDto : receivableDto),
              debtorName,
              dueDate: existing.parentId
                ? receivable.dueDate
                : dto.dueDate
                  ? parseDateOnly(dto.dueDate)
                  : receivable.dueDate,
              paidAt,
              paymentTransactionId,
            },
          });

          updatedReceivables.push(updatedReceivable);
        }

        return normalizedScope === 'ONE'
          ? updatedReceivables[0]
          : updatedReceivables;
      },
    );
  }

  async remove(id: string, userId: string, scope?: string) {
    const existing = await this.entityValidationService.validateReceivable(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const receivablesToDelete = await this.getReceivablesByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        for (const receivable of receivablesToDelete) {
          await tx.receivable.delete({
            where: { id: receivable.id, userId },
          });

          if (receivable.transactionId) {
            const transaction = await tx.transaction.findUnique({
              where: { id: receivable.transactionId, userId },
            });

            if (transaction) {
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
          }

          if (receivable.paymentTransactionId) {
            const paymentTransaction = await tx.transaction.findUnique({
              where: { id: receivable.paymentTransactionId, userId },
            });

            if (paymentTransaction) {
              await tx.transaction.delete({
                where: { id: paymentTransaction.id, userId },
              });

              if (paymentTransaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: paymentTransaction.invoiceId, userId },
                  data: {
                    totalAmount: { decrement: paymentTransaction.amount },
                  },
                });

                if (Number(invoice.totalAmount) === 0) {
                  await tx.invoice.delete({
                    where: { id: invoice.id, userId },
                  });
                }
              }
            }
          }
        }

        return;
      },
    );
  }

  private normalizeScope(scope?: string): ReceivableScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    return 'ONE';
  }

  private async getReceivablesByScope(
    tx: Prisma.TransactionClient,
    receivable: Receivable,
    userId: string,
    scope: ReceivableScope,
  ) {
    if (!receivable.parentId || scope === 'ONE') {
      return [receivable];
    }

    if (scope === 'NEXT') {
      return await tx.receivable.findMany({
        where: {
          userId,
          parentId: receivable.parentId,
          dueDate: {
            gte: receivable.dueDate,
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
      });
    }

    return await tx.receivable.findMany({
      where: {
        userId,
        parentId: receivable.parentId,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });
  }
}
