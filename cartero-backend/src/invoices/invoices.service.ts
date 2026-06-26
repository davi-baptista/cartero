import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindInvoicesDto } from './dto/find-invoices.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async findOne(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id, userId },
      include: {
        transactions: {
          include: {
            category: {
              select: { id: true, name: true, color: true, icon: true },
            },
          },
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');
    return invoice;
  }

  async findAll(userId: string, filters: FindInvoicesDto = {}) {
    return await this.prisma.invoice.findMany({
      where: {
        userId,
        bankId: filters.bankId,
        month: filters.month,
        year: filters.year,
      },
      include: { bank: true },
    });
  }

  async update(id: string, userId: string, dto: UpdateInvoiceDto) {
    await this.entityValidationService.validateInvoice(id, userId);

    return await this.prisma.invoice.update({
      where: { id, userId },
      data: dto,
    });
  }
}
