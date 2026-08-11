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
      const createsIncome = receivables.length > 0 && user.createIncomeOnReceivablePaid;
      const createsExpense = debts.length > 0 && user.createExpenseOnDebtPaid;

      if (createsExpense) {
        if (!dto.paymentBankId || !dto.paymentType) {
          throw new BadRequestException('Informe o banco e a forma de pagamento para quitar o saldo');
        }
        if (dto.paymentType === TransactionType.INCOME) {
          throw new BadRequestException('A forma de pagamento da quitação não pode ser receita');
        }
      }

      // Cada dívida/cobrança gera sua própria transação de pagamento individual —
      // exatamente como marcar um item sozinho — para que a reversão funcione
      // normalmente item a item, sem um registro agregado irreversível.
      if (createsExpense) {
        const debtCategory = await this.entityValidationService.findOrCreateSystemCategory(
          tx,
          userId,
          DEBT_PAID_CATEGORY_NAME,
          SYSTEM_CATEGORY_ICON,
          DEBT_PAID_CATEGORY_COLOR,
        );
        const paymentBank = await this.entityValidationService.validateBank(dto.paymentBankId as string, userId);

        for (const debt of debts) {
          let invoiceId: string | null = null;
          if (dto.paymentType === TransactionType.CREDIT_CARD) {
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
              categoryId: debtCategory.id,
              invoiceId,
              title: debt.title,
              type: dto.paymentType as TransactionType,
              amount: debt.amount,
              date: paymentDate,
            },
          });

          if (invoiceId) {
            await tx.invoice.update({
              where: { id: invoiceId, userId },
              data: { totalAmount: { increment: debt.amount } },
            });
          }

          await tx.debt.update({
            where: { id: debt.id, userId },
            data: {
              isPaid: true,
              paidAt: paymentDate,
              paymentTransactionId: paymentTransaction.id,
            },
          });
        }
      } else if (debts.length > 0) {
        await tx.debt.updateMany({
          where: { userId, id: { in: debts.map((debt) => debt.id) }, isPaid: false },
          data: { isPaid: true, paidAt: paymentDate },
        });
      }

      if (createsIncome) {
        const receivableCategory = await this.entityValidationService.findOrCreateSystemCategory(
          tx,
          userId,
          RECEIVABLE_RECEIVED_CATEGORY_NAME,
          SYSTEM_CATEGORY_ICON,
          RECEIVABLE_RECEIVED_CATEGORY_COLOR,
        );
        const receivableBank = await findOrCreateSystemReceivableBank(tx, userId);

        for (const receivable of receivables) {
          const paymentTransaction = await tx.transaction.create({
            data: {
              userId,
              bankId: receivableBank.id,
              categoryId: receivableCategory.id,
              title: receivable.title,
              type: TransactionType.INCOME,
              amount: receivable.amount,
              date: paymentDate,
            },
          });

          await tx.receivable.update({
            where: { id: receivable.id, userId },
            data: {
              isPaid: true,
              paidAt: paymentDate,
              paymentTransactionId: paymentTransaction.id,
            },
          });
        }
      } else if (receivables.length > 0) {
        await tx.receivable.updateMany({
          where: { userId, id: { in: receivables.map((receivable) => receivable.id) }, isPaid: false },
          data: { isPaid: true, paidAt: paymentDate },
        });
      }

      return {
        person,
        totalDebts,
        totalReceivables,
        netBalance,
        settledDebts: debts.length,
        settledReceivables: receivables.length,
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
