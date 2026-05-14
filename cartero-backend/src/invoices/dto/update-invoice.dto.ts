import { InvoiceStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateInvoiceDto {
  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;
}
