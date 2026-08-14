import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { deriveInvoiceStatus } from 'src/common/helpers/invoice.helper';

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
            person: { select: { id: true, name: true } },
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

  /**
   * Desfaz o pagamento de uma fatura, devolvendo o status que ela teria pelas
   * próprias datas. Necessário para editar lançamentos de uma fatura paga —
   * a edição é bloqueada enquanto ela estiver nesse estado.
   */
  async reopen(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id, userId },
      include: { bank: true },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');

    if (invoice.status !== 'PAID') {
      throw new BadRequestException('A fatura não está paga');
    }

    return this.prisma.invoice.update({
      where: { id, userId },
      data: {
        status: deriveInvoiceStatus(
          {
            invoiceDueDate: invoice.bank.invoiceDueDate,
            invoiceDueDaysAfterClose: invoice.bank.invoiceDueDaysAfterClose,
          },
          invoice.year,
          invoice.month,
        ),
      },
    });
  }
}
