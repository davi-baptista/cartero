import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { CreateDebtDto } from './dto/create-debt.dto';

@Injectable()
export class DebtsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateDebtDto) {
    return await this.prisma.debt.create({
      data: {
        userId,
        title: dto.title,
        creditorName: dto.creditorName,
        amount: dto.amount,
        dueDate: dto.dueDate,
        isAlertEnabled: dto.isAlertEnabled,
        isPaid: dto.isPaid ? dto.isPaid : false,
        paidAt: new Date(),
      },
    });
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateDebt(id, userId);
  }

  async findAll(userId: string) {
    return await this.prisma.debt.findMany({
      where: { userId },
    });
  }

  async update(id: string, userId: string, dto: UpdateDebtDto) {
    const debt = await this.entityValidationService.validateDebt(id, userId);
    let transactionId: string | undefined;
    let paidAt: Date | undefined;

    if (debt.isPaid === true) {
      const isTryingToChangeLockedFields =
        dto.amount !== undefined ||
        dto.title !== undefined ||
        dto.bankId !== undefined ||
        dto.categoryId !== undefined;

      if (isTryingToChangeLockedFields) {
        throw new ConflictException(
          'Não é possível alterar valor, título, banco ou categoria de uma dívida já paga',
        );
      }
    }

    if (dto.isPaid === true && debt.isPaid === false) {
      paidAt = new Date();

      if (dto.bankId) {
        await this.entityValidationService.validateBank(dto.bankId, userId);

        if (!dto.categoryId) {
          throw new ConflictException(
            'Categoria é obrigatória para gerar transação ao pagar a dívida',
          );
        }

        await this.entityValidationService.validateCategory(
          dto.categoryId,
          userId,
        );

        const transaction = await this.prisma.transaction.create({
          data: {
            userId,
            bankId: dto.bankId,
            categoryId: dto.categoryId,
            title: debt.title,
            amount: debt.amount,
            description: debt.description,
            date: paidAt,
            type: 'PAYMENT_OF_DEBT',
          },
        });

        transactionId = transaction.id;
      }
    }

    return await this.prisma.debt.update({
      where: { id, userId },
      data: {
        title: dto.title,
        creditorName: dto.creditorName,
        amount: dto.amount,
        description: dto.description,
        dueDate: dto.dueDate,
        isAlertEnabled: dto.isAlertEnabled,
        isPaid: dto.isPaid,
        paidAt,
        transactionId,
      },
    });
  }

  async remove(id: string, userId: string) {
    const debt = await this.entityValidationService.validateDebt(id, userId);

    if (debt.transactionId) {
      await this.prisma.transaction.delete({
        where: { id: debt.transactionId, userId },
      });
    }

    await this.prisma.debt.delete({
      where: { id, userId },
    });

    return;
  }
}
