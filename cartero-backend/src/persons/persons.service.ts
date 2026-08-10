import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { parseDateFilterEnd, parseDateFilterStart } from 'src/common/helpers/date-only.helper';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import { findOrCreateInvoice, findOrCreateSystemReceivableBank } from 'src/common/helpers/invoice.helper';
import {
  DEBT_PAID_CATEGORY_COLOR,
  DEBT_PAID_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  RECEIVABLE_RECEIVED_CATEGORY_NAME,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindPersonsDto } from './dto/find-persons.dto';
import { GetStatementDto } from './dto/get-statement.dto';
import { SettlePersonDto } from './dto/settle-person.dto';

@Injectable()
export class PersonsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreatePersonDto) {
    const existing = await this.prisma.person.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Pessoa já existe');
    }

    return await this.prisma.person.create({
      data: {
        userId,
        name: dto.name,
        phone: dto.phone?.trim() || null,
      },
    });
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validatePerson(id, userId);
  }

  async findAll(userId: string, filters: FindPersonsDto = {}) {
    return await this.prisma.person.findMany({
      where: {
        userId,
        name: filters.name
          ? { contains: filters.name, mode: 'insensitive' }
          : undefined,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdatePersonDto) {
    await this.entityValidationService.validatePerson(id, userId);

    return await this.prisma.person.update({
      where: { id, userId },
      data: {
        ...dto,
        phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
      },
    });
  }

  async remove(id: string, userId: string) {
    await this.entityValidationService.validatePerson(id, userId);

    await this.prisma.person.delete({
      where: { id, userId },
    });

    return;
  }

  async settle(id: string, userId: string, dto: SettlePersonDto) {
    const person = await this.entityValidationService.validatePerson(id, userId);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const dueDate = {
        gte: dto.startDate ? parseDateFilterStart(dto.startDate) : undefined,
        lte: dto.endDate ? parseDateFilterEnd(dto.endDate) : undefined,
      };
      const [debts, receivables, user] = await Promise.all([
        tx.debt.findMany({ where: { userId, personId: person.id, isPaid: false, dueDate } }),
        tx.receivable.findMany({ where: { userId, personId: person.id, isPaid: false, dueDate } }),
        tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            createIncomeOnReceivablePaid: true,
            createExpenseOnDebtPaid: true,
          },
        }),
      ]);

      const totalReceivables = receivables.reduce((sum, item) => sum + Number(item.amount), 0);
      const totalDebts = debts.reduce((sum, item) => sum + Number(item.amount), 0);
      const netBalance = totalReceivables - totalDebts;
      const paymentDate = dto.paymentDate ? parseDateOnly(dto.paymentDate) : new Date();
      const createsIncome = netBalance > 0 && user.createIncomeOnReceivablePaid;
      const createsExpense = netBalance < 0 && user.createExpenseOnDebtPaid;

      let paymentTransactionId: string | null = null;

      if (createsExpense) {
        if (!dto.paymentBankId || !dto.paymentType) {
          throw new BadRequestException('Informe o banco e a forma de pagamento para quitar o saldo');
        }
        if (dto.paymentType === TransactionType.INCOME) {
          throw new BadRequestException('A forma de pagamento da quitação não pode ser receita');
        }
      }

      if (createsIncome || createsExpense) {
        const category = await this.entityValidationService.findOrCreateSystemCategory(
          tx,
          userId,
          createsIncome ? RECEIVABLE_RECEIVED_CATEGORY_NAME : DEBT_PAID_CATEGORY_NAME,
          SYSTEM_CATEGORY_ICON,
          createsIncome ? RECEIVABLE_RECEIVED_CATEGORY_COLOR : DEBT_PAID_CATEGORY_COLOR,
        );

        const paymentBank = createsExpense
          ? await this.entityValidationService.validateBank(dto.paymentBankId as string, userId)
          : await findOrCreateSystemReceivableBank(tx, userId);

        let invoiceId: string | null = null;
        if (createsExpense && dto.paymentType === TransactionType.CREDIT_CARD) {
          const invoice = await findOrCreateInvoice(
            tx,
            userId,
            paymentBank.id,
            paymentBank.invoiceDueDate,
            paymentBank.invoiceDueDaysAfterClose,
            paymentDate,
          );
          invoiceId = invoice.id;
        }

        const paymentTransaction = await tx.transaction.create({
          data: {
            userId,
            bankId: paymentBank.id,
            categoryId: category.id,
            invoiceId,
            title: `Acerto com ${person.name}`,
            type: createsIncome ? TransactionType.INCOME : (dto.paymentType as TransactionType),
            amount: Math.abs(netBalance),
            date: paymentDate,
          },
        });

        paymentTransactionId = paymentTransaction.id;

        if (invoiceId) {
          await tx.invoice.update({
            where: { id: invoiceId, userId },
            data: { totalAmount: { increment: Math.abs(netBalance) } },
          });
        }
      }

      if (debts.length > 0) {
        await tx.debt.updateMany({
          where: { userId, id: { in: debts.map((debt) => debt.id) }, isPaid: false },
          data: {
            isPaid: true,
            paidAt: paymentDate,
            settledAt: paymentTransactionId ? paymentDate : null,
          },
        });
      }
      if (receivables.length > 0) {
        await tx.receivable.updateMany({
          where: { userId, id: { in: receivables.map((receivable) => receivable.id) }, isPaid: false },
          data: {
            isPaid: true,
            paidAt: paymentDate,
            settledAt: paymentTransactionId ? paymentDate : null,
          },
        });
      }

      return {
        person,
        totalDebts,
        totalReceivables,
        netBalance,
        settledDebts: debts.length,
        settledReceivables: receivables.length,
        paymentTransactionId,
      };
    });
  }

  async getStatement(
    id: string,
    userId: string,
    filters: GetStatementDto = {},
  ) {
    const person = await this.entityValidationService.validatePerson(
      id,
      userId,
    );

    const dateFilter = {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
    };

    const debts = await this.prisma.debt.findMany({
      where: { personId: person.id, userId, dueDate: dateFilter },
    });

    const receivables = await this.prisma.receivable.findMany({
      where: { personId: person.id, userId, dueDate: dateFilter },
    });

    const totalDebts = debts
      .filter((d) => !d.isPaid)
      .reduce((acc, d) => acc + Number(d.amount), 0);

    const totalReceivables = receivables
      .filter((r) => !r.isPaid)
      .reduce((acc, r) => acc + Number(r.amount), 0);

    return {
      person,
      totalDebts,
      totalReceivables,
      netBalance: totalReceivables - totalDebts,
      debts,
      receivables,
    };
  }
}
