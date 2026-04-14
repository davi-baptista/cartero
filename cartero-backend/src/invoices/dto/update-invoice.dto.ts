import { InvoiceStatus } from '@prisma/client';

export class UpdateInvoiceDto {
  status: InvoiceStatus;
}
