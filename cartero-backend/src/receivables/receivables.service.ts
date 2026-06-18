import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Receivable } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
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
    let debtorName : string
    
    if(dto.personId) {
      const person = await this.entityValidationService.validatePerson(dto.personId, userId)
      debtorName = person.name
    } else if (dto.debtorName) {
      debtorName = dto.debtorName
    } else {
      throw new BadRequestException('Informe debtorName ou personId')
    }
    
    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments = dto.installments ? dto.installments : 1;
        const receivables: Receivable[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
          const installmentDate = getInstallmentDate(new Date(dto.dueDate), i);

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
          gte: filters.startDate ? new Date(filters.startDate) : undefined,
          lte: filters.endDate ? new Date(filters.endDate) : undefined,
        }, 
      },
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

    let debtorName = dto.debtorName
    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(dto.personId, userId)
      debtorName = person.name
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const receivablesToUpdate = await this.getReceivablesByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );
        const updatedReceivables: Receivable[] = [];

        for (const receivable of receivablesToUpdate) {
          const paidAt =
            dto.isPaid === true && !receivable.isPaid ? new Date() :
						dto.isPaid === false && receivable.isPaid ? null : undefined;

          const updatedReceivable = await tx.receivable.update({
            where: { id: receivable.id, userId },
            data: {
              ...dto,
              debtorName,
              dueDate: dto.dueDate ? new Date(dto.dueDate) : receivable.dueDate,
              paidAt,
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