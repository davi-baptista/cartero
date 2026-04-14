import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class EntityValidationService {
  constructor(private prisma: PrismaService) {}

  async validateTransaction(transactionId: string, userId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId, userId },
    });

    if (!transaction) {
      throw new NotFoundException('Transação não encontrada');
    }

    return transaction;
  }

  async validateBank(bankId: string, userId: string) {
    const bank = await this.prisma.bank.findUnique({
      where: {
        id: bankId,
        userId,
      },
    });

    if (!bank) {
      throw new NotFoundException('Banco não encontrado');
    }

    return bank;
  }

  async validateCategory(categoryId: string, userId: string) {
    const category = await this.prisma.category.findUnique({
      where: {
        id: categoryId,
        userId,
      },
    });

    if (!category) {
      throw new NotFoundException('Categoria não encontrada');
    }

    return category;
  }

  async validateInvoice(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id: invoiceId,
        userId,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    return invoice;
  }

  async validateDebt(debtId: string, userId: string) {
    const debt = await this.prisma.debt.findUnique({
      where: {
        id: debtId,
        userId,
      },
    });

    if (!debt) {
      throw new NotFoundException('Dívida não encontrada');
    }

    return debt;
  }
}
