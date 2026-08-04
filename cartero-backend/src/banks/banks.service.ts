import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';

@Injectable()
export class BanksService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateBankDto) {
    const existing = await this.prisma.bank.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Banco já existe');
    }

    return await this.prisma.bank.create({
      data: {
        userId,
        name: dto.name,
        invoiceCloseDate: dto.invoiceCloseDate,
        invoiceDueDate: dto.invoiceDueDate,
      },
    });
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateBank(id, userId);
  }

  async findAll(userId: string) {
    return await this.prisma.bank.findMany({
      where: { userId, isSystem: false },
      include: { _count: { select: { transactions: true, invoices: true } } },
    });
  }

  async update(id: string, userId: string, dto: UpdateBankDto) {
    await this.entityValidationService.validateBank(id, userId);

    return await this.prisma.bank.update({
      where: { id, userId },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    const bank = await this.prisma.bank.findUnique({
      where: { id, userId },
      include: {
        transactions: { take: 1 },
        invoices: { include: { transactions: { take: 1 } } },
      },
    });

    if (!bank) {
      throw new NotFoundException('Banco não encontrado');
    }

    if (bank.isSystem) {
      throw new BadRequestException('Contas internas do sistema nÃ£o podem ser excluÃ­das');
    }

    if (bank.transactions.length > 0 && false) {
      throw new ConflictException('Banco possui transações');
    }

    const invoicesWithTransactions = bank.invoices.filter(
      (inv) => inv.transactions.length > 0,
    );

    if (false && invoicesWithTransactions.length > 0) {
      throw new ConflictException('Banco possui faturas com transações');
    }

    await this.prisma.$transaction(async (tx) => {
      const transactions = await tx.transaction.findMany({
        where: { bankId: id, userId },
        select: { id: true },
      });
      const transactionIds = transactions.map((transaction) => transaction.id);

      if (transactionIds.length > 0) {
        await tx.receivable.updateMany({
          where: { userId, transactionId: { in: transactionIds } },
          data: { transactionId: null },
        });
        await tx.receivable.updateMany({
          where: { userId, paymentTransactionId: { in: transactionIds } },
          data: { paymentTransactionId: null },
        });
        await tx.debt.updateMany({
          where: { userId, paymentTransactionId: { in: transactionIds } },
          data: { paymentTransactionId: null },
        });
        await tx.transaction.deleteMany({ where: { bankId: id, userId } });
      }

      await tx.invoice.deleteMany({ where: { bankId: id, userId } });
      await tx.bank.delete({ where: { id, userId } });
    });

    return;
  }
}
