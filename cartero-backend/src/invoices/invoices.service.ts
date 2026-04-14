import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateInvoice(id, userId);
  }

  async findAll(userId: string, bankId?: string) {
    return await this.prisma.invoice.findMany({
      where: { userId, bankId },
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
