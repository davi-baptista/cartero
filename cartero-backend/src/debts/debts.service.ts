import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Debt } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
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
          const installmentDate = getInstallmentDate(new Date(dto.dueDate), i);

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
          gte: filters.startDate ? new Date(filters.startDate) : undefined,
          lte: filters.endDate ? new Date(filters.endDate) : undefined,
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

          const updatedDebt = await tx.debt.update({
            where: { id: debt.id, userId },
            data: {
              ...dto,
              creditorName,
              dueDate: dto.dueDate ? new Date(dto.dueDate) : debt.dueDate,
              paidAt,
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
