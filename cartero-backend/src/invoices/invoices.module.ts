import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

@Module({
  providers: [InvoicesService],
  exports: [InvoicesService],
  controllers: [InvoicesController],
})
export class InvoicesModule {}
