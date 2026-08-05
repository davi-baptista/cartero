import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Debt, TransactionType } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import { findOrCreateInvoice } from 'src/common/helpers/invoice.helper';
import { parseDateFilterEnd, parseDateFilterStart, parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  DEBT_PAID_CATEGORY_NAME,
  DEBT_PAID_CATEGORY_COLOR,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDebtDto } from 'src/debts/dto/create-debt.dto';
import { UpdateDebtDto } from 'src/debts/dto/update-debt.dto';
import { FindDebtsDto } from './dto/find-debts.dto';

type DebtScope = 'ONE' | 'NEXT' | 'ALL';

@Injectable()
export class DebtsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateDebtDto) {
    let creditorName: string;

    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      creditorName = person.name;
    } else if (dto.creditorName) {
      creditorName = dto.creditorName;
    } else {
      throw new BadRequestException('Informe creditorName ou personId');
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments = dto.installments ? dto.installments : 1;
        const debts: Debt[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
            const installmentDate = getInstallmentDate(parseDateOnly(dto.dueDate), i);

          const debt: Debt = await tx.debt.create({
            data: {
              userId,
              parentId,
              title:
                installments > 1
                  ? `${dto.title} ${i + 1}/${installments}`
                  : dto.title,
              creditorName,
              personId: dto.personId,
              amount: dto.amount,
              description: dto.description,
              dueDate: installmentDate,
              isAlertEnabled: dto.isAlertEnabled,
            },
          });

          if (i === 0 && installments > 1) {
            parentId = debt.id;

            await tx.debt.update({
              where: { id: debt.id, userId },
              data: { parentId },
            });

            debt.parentId = parentId;
          }
          debts.push(debt);
        }
        return debts;
      },
    );
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateDebt(id, userId);
  }

  async findAll(userId: string, filters: FindDebtsDto = {}) {
    return await this.prisma.debt.findMany({
      where: {
        userId,
        creditorName: filters.creditorName,
        personId: filters.personId,
        dueDate: {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
        },
      },
      include: { person: true },
    });
  }

  async update(id: string, userId: string, dto: UpdateDebtDto, scope?: string) {
    const existing = await this.entityValidationService.validateDebt(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    let creditorName = dto.creditorName;
    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      creditorName = person.name;
    }

    const markingAsPaid = dto.isPaid === true;
    const userPreferences = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { createExpenseOnDebtPaid: true },
    });
    const shouldCreatePaymentTransaction =
      markingAsPaid && userPreferences.createExpenseOnDebtPaid;

    if (shouldCreatePaymentTransaction) {
      if (!dto.paymentBankId || !dto.paymentType) {
        throw new BadRequestException(
          'Informe paymentBankId e paymentType para marcar a dívida como paga',
        );
      }
      if (dto.paymentType === TransactionType.INCOME) {
        throw new BadRequestException(
          'paymentType inválido para pagamento de dívida',
        );
      }
    }

    const paymentBank = shouldCreatePaymentTransaction
      ? await this.entityValidationService.validateBank(
          dto.paymentBankId as string,
          userId,
        )
      : null;

    const { paymentBankId, paymentType, ...debtDto } = dto;
    const { title: _title, dueDate: _dueDate, ...installmentSafeDto } = debtDto;

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const debtsToUpdate = await this.getDebtsByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );
        const updatedDebts: Debt[] = [];

        for (const debt of debtsToUpdate) {
          const paidAt =
            dto.isPaid === true && !debt.isPaid
              ? new Date()
              : dto.isPaid === false && debt.isPaid
                ? null
                : undefined;

          let paymentTransactionId = debt.paymentTransactionId;

          if (
            shouldCreatePaymentTransaction &&
            paidAt !== undefined &&
            paidAt !== null &&
            !debt.paymentTransactionId
          ) {
            const category =
              await this.entityValidationService.findOrCreateSystemCategory(
                tx,
                userId,
                DEBT_PAID_CATEGORY_NAME,
                SYSTEM_CATEGORY_ICON,
                DEBT_PAID_CATEGORY_COLOR,
              );

            let invoiceId: string | null = null;
            if (paymentType === TransactionType.CREDIT_CARD) {
              const invoice = await findOrCreateInvoice(
                tx,
                userId,
                paymentBankId as string,
                paymentBank!.invoiceDueDate,
                paymentBank!.invoiceDueDaysAfterClose,
                paidAt,
              );
              invoiceId = invoice.id;
            }

            const paymentTransaction = await tx.transaction.create({
              data: {
                userId,
                bankId: paymentBankId as string,
                categoryId: category.id,
                invoiceId,
                title: debt.title,
                type: paymentType as TransactionType,
                amount: debt.amount,
                date: paidAt,
              },
            });

            if (invoiceId) {
              await tx.invoice.update({
                where: { id: invoiceId, userId },
                data: { totalAmount: { increment: debt.amount } },
              });
            }

            paymentTransactionId = paymentTransaction.id;
          } else if (paidAt === null && debt.paymentTransactionId) {
            const paymentTransaction = await tx.transaction.findUnique({
              where: { id: debt.paymentTransactionId, userId },
            });

            await tx.debt.update({
              where: { id: debt.id, userId },
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

            const updatedDebt = await tx.debt.update({
            where: { id: debt.id, userId },
            data: {
              ...(existing.parentId ? installmentSafeDto : debtDto),
              creditorName,
              dueDate: existing.parentId
                ? debt.dueDate
                : dto.dueDate
                  ? parseDateOnly(dto.dueDate)
                  : debt.dueDate,
              paidAt,
              paymentTransactionId,
            },
          });

          updatedDebts.push(updatedDebt);
        }

        return normalizedScope === 'ONE' ? updatedDebts[0] : updatedDebts;
      },
    );
  }

  async remove(id: string, userId: string, scope?: string) {
    const existing = await this.entityValidationService.validateDebt(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const debtsToDelete = await this.getDebtsByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        for (const debt of debtsToDelete) {
          await tx.debt.delete({
            where: { id: debt.id, userId },
          });

          if (debt.paymentTransactionId) {
            const transaction = await tx.transaction.findUnique({
              where: { id: debt.paymentTransactionId, userId },
            });

            if (transaction) {
              await tx.transaction.delete({
                where: { id: transaction.id, userId },
              });

              if (transaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: transaction.invoiceId, userId },
                  data: { totalAmount: { decrement: transaction.amount } },
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

  private normalizeScope(scope?: string): DebtScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    return 'ONE';
  }

  private async getDebtsByScope(
    tx: Prisma.TransactionClient,
    debt: Debt,
    userId: string,
    scope: DebtScope,
  ) {
    if (!debt.parentId || scope === 'ONE') {
      return [debt];
    }

    if (scope === 'NEXT') {
      return await tx.debt.findMany({
        where: {
          userId,
          parentId: debt.parentId,
          dueDate: {
            gte: debt.dueDate,
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
      });
    }

    return await tx.debt.findMany({
      where: {
        userId,
        parentId: debt.parentId,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });
  }
}
