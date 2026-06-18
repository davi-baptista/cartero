import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindPersonsDto } from './dto/find-persons.dto';
import { GetStatementDto } from './dto/get-statement.dto';

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
        name: filters.name ? { contains: filters.name, mode: 'insensitive' } : undefined,
     },
    });
  }

  async update(id: string, userId: string, dto: UpdatePersonDto) {
    await this.entityValidationService.validatePerson(id, userId);

    return await this.prisma.person.update({
      where: { id, userId },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.entityValidationService.validatePerson(id, userId);

    await this.prisma.person.delete({
      where: { id, userId },
    });

    return;
  }

  async getStatement(id: string, userId: string, filters: GetStatementDto = {}) {
    const person = await this.entityValidationService.validatePerson(id, userId);

    const dateFilter = {
      gte: filters.startDate ? new Date(filters.startDate) : undefined,
      lte: filters.endDate ? new Date(filters.endDate) : undefined,
    };

    const debts = await this.prisma.debt.findMany({
      where: { personId: person.id, userId, dueDate: dateFilter },
    });

    const receivables = await this.prisma.receivable.findMany({
      where: { personId: person.id, userId, dueDate: dateFilter },
    });

    const totalDebts = debts
      .filter(d => !d.isPaid)
      .reduce((acc, d) => acc + Number(d.amount), 0);

    const totalReceivables = receivables
      .filter(r => !r.isPaid)
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
